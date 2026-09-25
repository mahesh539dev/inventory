import { sql, eq, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import {
  insertSale,
  insertSaleItems,
  findSaleForUpdate,
  findSaleItemsForUpdate,
  updateSaleItemReturnedQuantity,
  updateSaleStatus,
  type SaleRow,
  type SaleItemRow,
} from "@/lib/repositories/sale.repo";
import { insertInventoryTransaction } from "@/lib/repositories/inventory.repo";
import { insertAuditLog } from "@/lib/repositories/audit-log.repo";
import { ProductNotFoundError } from "@/lib/services/product.service";

export class InsufficientInventoryError extends Error {
  constructor(
    public readonly productId: string,
    public readonly requested: number,
    public readonly available: number
  ) {
    super(
      `Insufficient inventory for product ${productId}: requested ${requested}, only ${available} available`
    );
    this.name = "InsufficientInventoryError";
  }
}

export type CompleteSaleInput = {
  items: { productId: string; quantity: number; soldPricePerUnit: number }[];
  buyerName?: string;
  buyerPhone?: string;
  userId: string;
};

export type SaleWithItems = SaleRow & { items: SaleItemRow[] };

function money(value: number): string {
  return value.toFixed(2);
}

export async function completeSale(input: CompleteSaleInput): Promise<SaleWithItems> {
  return db.transaction(async (tx) => {
    // Lock every DISTINCT product row involved, sorted by id — a stable
    // lock order across all concurrent completeSale calls, so two carts
    // that share two or more products (added in a different order) can
    // never deadlock against each other.
    const productIds = [...new Set(input.items.map((item) => item.productId))].sort();

    const lockedProducts = await tx
      .select()
      .from(products)
      .where(inArray(products.id, productIds))
      .orderBy(asc(products.id))
      .for("update");

    const productById = new Map(lockedProducts.map((p) => [p.id, p]));

    // A cart can contain two or more lines for the SAME product (e.g. added
    // separately, or with different soldPricePerUnit). Inventory math
    // (stock validation and the currentQuantity decrement) must operate on
    // the aggregated per-product total, not per line — otherwise two lines
    // checked independently against the same pre-transaction snapshot can
    // each individually "pass" a stock check while their sum oversells, and
    // a second per-line update can clobber the first's write instead of
    // compounding it. sale_items rows themselves stay one-per-line below,
    // preserving each line's own soldPricePerUnit.
    const aggregatedQuantityByProductId = new Map<string, number>();
    for (const item of input.items) {
      aggregatedQuantityByProductId.set(
        item.productId,
        (aggregatedQuantityByProductId.get(item.productId) ?? 0) + item.quantity
      );
    }

    // Validate every distinct product BEFORE writing anything — any single
    // failure must roll back the whole transaction, not just skip that line.
    for (const [productId, totalQuantity] of aggregatedQuantityByProductId) {
      const product = productById.get(productId);
      if (!product) {
        throw new ProductNotFoundError(productId);
      }
      if (product.currentQuantity < totalQuantity) {
        throw new InsufficientInventoryError(productId, totalQuantity, product.currentQuantity);
      }
    }

    let totalAmount = 0;
    let totalCost = 0;
    let totalProfit = 0;
    const saleItemsData: {
      productId: string;
      quantity: number;
      costPerUnit: string;
      soldPricePerUnit: string;
      totalCost: string;
      totalRevenue: string;
      profit: string;
    }[] = [];

    for (const item of input.items) {
      const product = productById.get(item.productId)!;
      const costPerUnit = Number(product.costPrice);
      const lineRevenue = item.soldPricePerUnit * item.quantity;
      const lineCost = costPerUnit * item.quantity;
      const lineProfit = lineRevenue - lineCost;

      totalAmount += lineRevenue;
      totalCost += lineCost;
      totalProfit += lineProfit;

      saleItemsData.push({
        productId: item.productId,
        quantity: item.quantity,
        costPerUnit: money(costPerUnit),
        soldPricePerUnit: money(item.soldPricePerUnit),
        totalCost: money(lineCost),
        totalRevenue: money(lineRevenue),
        profit: money(lineProfit),
      });
    }

    // Apply the inventory decrement once per distinct product, using the
    // aggregated total across all of that product's lines — not once per
    // line off a shared pre-transaction snapshot (see aggregation above).
    for (const [productId, totalQuantity] of aggregatedQuantityByProductId) {
      const product = productById.get(productId)!;
      await tx
        .update(products)
        .set({ currentQuantity: product.currentQuantity - totalQuantity, updatedAt: new Date() })
        .where(eq(products.id, productId));
    }

    const { rows } = await tx.execute<{ nextval: string }>(sql`SELECT nextval('sale_number_seq')`);
    const saleNumber = `SALE-${rows[0].nextval.padStart(6, "0")}`;

    const sale = await insertSale(
      {
        saleNumber,
        soldBy: input.userId,
        totalAmount: money(totalAmount),
        totalCost: money(totalCost),
        totalProfit: money(totalProfit),
        status: "COMPLETED",
        buyerName: input.buyerName ?? null,
        buyerPhone: input.buyerPhone ?? null,
      },
      tx
    );

    const items = await insertSaleItems(
      saleItemsData.map((item) => ({ ...item, saleId: sale.id })),
      tx
    );

    for (const item of input.items) {
      await insertInventoryTransaction(
        {
          productId: item.productId,
          type: "SALE",
          quantity: -item.quantity,
          referenceId: sale.id,
          notes: `Sale ${saleNumber}`,
          createdBy: input.userId,
        },
        tx
      );
    }

    return { ...sale, items };
  });
}

export class SaleNotFoundError extends Error {
  constructor(public readonly saleId: string) {
    super(`Sale not found: ${saleId}`);
    this.name = "SaleNotFoundError";
  }
}

export class SaleNotCancellableError extends Error {
  constructor(public readonly saleId: string, public readonly currentStatus: string) {
    super(`Sale ${saleId} cannot be cancelled (status: ${currentStatus})`);
    this.name = "SaleNotCancellableError";
  }
}

export class InvalidReturnQuantityError extends Error {
  constructor(
    public readonly saleItemId: string,
    public readonly requested: number,
    public readonly remaining: number
  ) {
    super(
      `Invalid return quantity for sale item ${saleItemId}: requested ${requested}, only ${remaining} remaining`
    );
    this.name = "InvalidReturnQuantityError";
  }
}

export type ReturnSaleItemsInput = {
  saleId: string;
  userId: string;
  items: { saleItemId: string; quantity: number }[];
};

// Shared by returnSaleItems and cancelSale: given a locked sale + its locked
// items, and the exact per-line quantities to return, restocks inventory,
// records one inventory_transactions row per line, recomputes and writes
// the sale's status, and writes one audit_logs row for the whole action.
// Callers must have already validated every line — this function performs
// no validation of its own, only mutation, so it can't partially apply a
// request its caller already accepted.
async function applyReturn(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    sale: SaleRow;
    items: SaleItemRow[];
    toReturn: Map<string, number>; // saleItemId -> quantity to return now
    userId: string;
    action: "SALE_RETURNED" | "SALE_CANCELLED";
    noteVerb: string; // "Return against" | "Cancelled"
  }
): Promise<SaleWithItems> {
  const itemById = new Map(params.items.map((item) => [item.id, item]));

  for (const [saleItemId, quantity] of params.toReturn) {
    const item = itemById.get(saleItemId)!;
    const newReturnedQuantity = item.returnedQuantity + quantity;

    await updateSaleItemReturnedQuantity(saleItemId, newReturnedQuantity, tx);

    await tx
      .update(products)
      .set({
        currentQuantity: sql`${products.currentQuantity} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(products.id, item.productId));

    await insertInventoryTransaction(
      {
        productId: item.productId,
        type: "RETURN",
        quantity,
        referenceId: params.sale.id,
        notes: `${params.noteVerb} Sale ${params.sale.saleNumber}`,
        createdBy: params.userId,
      },
      tx
    );

    item.returnedQuantity = newReturnedQuantity; // keep local copy in sync for the status computation below
  }

  const allReturned = params.items.every((item) => item.returnedQuantity >= item.quantity);
  const anyReturned = params.items.some((item) => item.returnedQuantity > 0);
  const newStatus = params.action === "SALE_CANCELLED"
    ? "CANCELLED"
    : allReturned
      ? "RETURNED"
      : anyReturned
        ? "PARTIALLY_RETURNED"
        : params.sale.status; // unreachable in practice (toReturn is always non-empty), kept for type-safety

  await updateSaleStatus(params.sale.id, newStatus, tx);

  await insertAuditLog(
    {
      userId: params.userId,
      action: params.action,
      entityType: "sale",
      entityId: params.sale.id,
      metadata: {
        items: [...params.toReturn.entries()].map(([saleItemId, quantity]) => ({
          saleItemId,
          productId: itemById.get(saleItemId)!.productId,
          quantity,
        })),
        resultingStatus: newStatus,
      },
    },
    tx
  );

  return { ...params.sale, status: newStatus, items: params.items };
}

export async function returnSaleItems(input: ReturnSaleItemsInput): Promise<SaleWithItems> {
  if (input.items.length === 0) {
    throw new InvalidReturnQuantityError("(none)", 0, 0);
  }

  return db.transaction(async (tx) => {
    const sale = await findSaleForUpdate(input.saleId, tx);
    if (!sale) {
      throw new SaleNotFoundError(input.saleId);
    }
    if (sale.status !== "COMPLETED" && sale.status !== "PARTIALLY_RETURNED") {
      throw new SaleNotCancellableError(input.saleId, sale.status);
    }

    const items = await findSaleItemsForUpdate(input.saleId, tx);
    const itemById = new Map(items.map((item) => [item.id, item]));

    // Validate every requested line BEFORE writing anything — a single bad
    // line must roll back the whole call, not apply the valid lines and
    // skip the bad one.
    const toReturn = new Map<string, number>();
    for (const { saleItemId, quantity } of input.items) {
      const item = itemById.get(saleItemId);
      const remaining = item ? item.quantity - item.returnedQuantity : 0;
      if (!item || quantity <= 0 || quantity > remaining) {
        throw new InvalidReturnQuantityError(saleItemId, quantity, remaining);
      }
      toReturn.set(saleItemId, (toReturn.get(saleItemId) ?? 0) + quantity);
    }

    return applyReturn(tx, {
      sale,
      items,
      toReturn,
      userId: input.userId,
      action: "SALE_RETURNED",
      noteVerb: "Return against",
    });
  });
}

export type CancelSaleInput = { saleId: string; userId: string };

export async function cancelSale(input: CancelSaleInput): Promise<SaleWithItems> {
  return db.transaction(async (tx) => {
    const sale = await findSaleForUpdate(input.saleId, tx);
    if (!sale) {
      throw new SaleNotFoundError(input.saleId);
    }
    if (sale.status !== "COMPLETED") {
      throw new SaleNotCancellableError(input.saleId, sale.status);
    }

    const items = await findSaleItemsForUpdate(input.saleId, tx);
    const toReturn = new Map(items.map((item) => [item.id, item.quantity - item.returnedQuantity]));

    return applyReturn(tx, {
      sale,
      items,
      toReturn,
      userId: input.userId,
      action: "SALE_CANCELLED",
      noteVerb: "Cancelled",
    });
  });
}
