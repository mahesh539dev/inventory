import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { insertProduct } from "@/lib/repositories/product.repo";
import { GET } from "@/app/api/public/products/[identifier]/route";

const TEST_SKU = "TEST-PUBLIC-API-001";
const IDENTIFIER = "test-public-api-pubid-001";

describe("GET /api/public/products/[identifier]", () => {
  beforeAll(async () => {
    await insertProduct({
      publicIdentifier: IDENTIFIER,
      sku: TEST_SKU,
      productName: "Public API Test Product",
      productImage: "https://example.com/photo.jpg",
      originalPrice: "100.00",
      costPrice: "50.00",
      sellingPrice: "79.99",
      currentQuantity: 2,
    });
  });

  afterAll(async () => {
    await db.delete(products).where(eq(products.sku, TEST_SKU));
  });

  it("returns only the restricted fields with no auth required", async () => {
    const response = await GET(new Request(`http://localhost/api/public/products/${IDENTIFIER}`) as never, {
      params: Promise.resolve({ identifier: IDENTIFIER }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      productName: "Public API Test Product",
      sellingPrice: "79.99",
      productImage: "https://example.com/photo.jpg",
    });
    expect(Object.keys(body).sort()).toEqual(["productImage", "productName", "sellingPrice"]);
  });

  it("returns 404 for an unknown identifier", async () => {
    const response = await GET(new Request("http://localhost/api/public/products/nonexistent") as never, {
      params: Promise.resolve({ identifier: "nonexistent" }),
    });

    expect(response.status).toBe(404);
  });
});
