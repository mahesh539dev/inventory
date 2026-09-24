import { sql, eq, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { insertSale, insertSaleItems, type SaleRow, type SaleItemRow } from "@/lib/repositories/sale.repo";
import { insertInventoryTransaction } from "@/lib/repositories/inventory.repo";
import { ProductNotFoundError } from "@/lib/services/product.service";

export class InsufficientInventoryError extends Error {
  constructor(productId: string, requested: number, available: number) {
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

    // Validate every line BEFORE writing anything — any single failure
    // must roll back the whole transaction, not just skip that line.
    for (const item of input.items) {
      const product = productById.get(item.productId);
      if (!product) {
        throw new ProductNotFoundError(item.productId);
      }
      if (product.currentQuantity < item.quantity) {
        throw new InsufficientInventoryError(item.productId, item.quantity, product.currentQuantity);
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

      await tx
        .update(products)
        .set({ currentQuantity: product.currentQuantity - item.quantity, updatedAt: new Date() })
        .where(eq(products.id, item.productId));
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
