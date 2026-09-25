import { sql, eq, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { insertSale, insertSaleItems, type SaleRow, type SaleItemRow } from "@/lib/repositories/sale.repo";
import { insertInventoryTransaction } from "@/lib/repositories/inventory.repo";
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
