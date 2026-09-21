import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  insertProduct,
  findPublicProductView,
  findProductByPublicIdentifier,
  regeneratePublicIdentifier,
} from "@/lib/repositories/product.repo";

const TEST_SKU = "TEST-QR-REPO-001";
const ORIGINAL_IDENTIFIER = "test-qr-repo-pubid-001";

describe("product.repo QR queries", () => {
  let productId: string;

  beforeAll(async () => {
    const inserted = await insertProduct({
      publicIdentifier: ORIGINAL_IDENTIFIER,
      sku: TEST_SKU,
      productName: "QR Repo Test Product",
      productImage: "https://example.com/photo.jpg",
      originalPrice: "100.00",
      costPrice: "50.00",
      sellingPrice: "89.99",
      currentQuantity: 3,
    });
    productId = inserted.id;
  });

  afterAll(async () => {
    await db.delete(products).where(eq(products.sku, TEST_SKU));
  });

  it("findPublicProductView returns only the restricted fields", async () => {
    const view = await findPublicProductView(ORIGINAL_IDENTIFIER);
    expect(view).toEqual({
      productName: "QR Repo Test Product",
      sellingPrice: "89.99",
      productImage: "https://example.com/photo.jpg",
    });
    // Explicitly confirm no other keys leaked through (e.g. costPrice).
    expect(Object.keys(view!).sort()).toEqual(["productImage", "productName", "sellingPrice"]);
  });

  it("findPublicProductView returns undefined for an unknown identifier", async () => {
    const view = await findPublicProductView("does-not-exist");
    expect(view).toBeUndefined();
  });

  it("findProductByPublicIdentifier returns the full row", async () => {
    const row = await findProductByPublicIdentifier(ORIGINAL_IDENTIFIER);
    expect(row?.id).toBe(productId);
    expect(row?.costPrice).toBe("50.00");
    expect(row?.currentQuantity).toBe(3);
  });

  it("regeneratePublicIdentifier changes the identifier and old one stops resolving", async () => {
    const updated = await regeneratePublicIdentifier(productId, "test-qr-repo-pubid-002");
    expect(updated.publicIdentifier).toBe("test-qr-repo-pubid-002");

    const oldLookup = await findProductByPublicIdentifier(ORIGINAL_IDENTIFIER);
    expect(oldLookup).toBeUndefined();

    const newLookup = await findProductByPublicIdentifier("test-qr-repo-pubid-002");
    expect(newLookup?.id).toBe(productId);
  });
});
