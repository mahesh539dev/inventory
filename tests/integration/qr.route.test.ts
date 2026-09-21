import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { insertProduct } from "@/lib/repositories/product.repo";

vi.mock("@/lib/auth/guards", () => ({
  requireUser: vi.fn(),
}));

import { requireUser } from "@/lib/auth/guards";
import { GET } from "@/app/api/products/[id]/qr/route";

const TEST_SKU = "TEST-QR-ROUTE-001";
const ORIGINAL_APP_URL = process.env.APP_URL;

describe("GET /api/products/[id]/qr", () => {
  let productId: string;

  beforeAll(async () => {
    process.env.APP_URL = "https://inventory.example.com";
    const inserted = await insertProduct({
      publicIdentifier: "test-qr-route-pubid-001",
      sku: TEST_SKU,
      productName: "QR Route Test Product",
      originalPrice: "100.00",
      costPrice: "50.00",
      currentQuantity: 1,
    });
    productId = inserted.id;
  });

  afterAll(async () => {
    await db.delete(products).where(eq(products.sku, TEST_SKU));
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
  });

  it("propagates the auth guard's rejection when unauthenticated", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("redirect to login"));

    await expect(
      GET(new Request(`http://localhost/api/products/${productId}/qr`) as never, {
        params: Promise.resolve({ id: productId }),
      })
    ).rejects.toThrow();
  });

  it("returns a PNG image for an authenticated user", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "u@example.com" });

    const response = await GET(
      new Request(`http://localhost/api/products/${productId}/qr`) as never,
      { params: Promise.resolve({ id: productId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe("inline");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("sets an attachment disposition with the SKU-based filename when download=1", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "u@example.com" });

    const response = await GET(
      new Request(`http://localhost/api/products/${productId}/qr?download=1`) as never,
      { params: Promise.resolve({ id: productId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${TEST_SKU}-qr.png"`
    );
  });

  it("returns 404 for an unknown product id", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user-1", role: "USER", email: "u@example.com" });

    const response = await GET(
      new Request("http://localhost/api/products/00000000-0000-0000-0000-000000000000/qr") as never,
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );

    expect(response.status).toBe(404);
  });
});
