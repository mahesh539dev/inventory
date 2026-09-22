import { nanoid } from "nanoid";
import {
  findProductBySku,
  insertProduct as repoInsertProduct,
  updateProduct as repoUpdateProduct,
  archiveProduct as repoArchiveProduct,
  findProductById,
  regeneratePublicIdentifier,
  type ProductRow,
} from "@/lib/repositories/product.repo";
import { findOrCreateCategory } from "@/lib/repositories/category.repo";
import type { CreateProductInput, UpdateProductInput } from "@/lib/validation/product.schema";

export class DuplicateSkuError extends Error {
  constructor(sku: string) {
    super(`SKU already exists: ${sku}`);
    this.name = "DuplicateSkuError";
  }
}

export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Product not found: ${id}`);
    this.name = "ProductNotFoundError";
  }
}

async function resolveCategoryId(categoryName: string): Promise<string | undefined> {
  if (!categoryName || categoryName.trim().length === 0) return undefined;
  const category = await findOrCreateCategory(categoryName);
  return category.id;
}

// Unlike resolveCategoryId (used on create, where "no category" means "omit the
// field"), an update must be able to express "clear the category" explicitly.
// Drizzle's update builder drops `undefined` values from the SET clause, so
// returning `undefined` here would silently leave the old categoryId in place.
async function resolveCategoryIdForUpdate(categoryName: string): Promise<string | null> {
  if (!categoryName || categoryName.trim().length === 0) return null;
  const category = await findOrCreateCategory(categoryName);
  return category.id;
}

export async function createProduct(input: CreateProductInput): Promise<ProductRow> {
  const existing = await findProductBySku(input.sku);
  if (existing) {
    throw new DuplicateSkuError(input.sku);
  }

  const categoryId = await resolveCategoryId(input.categoryName);

  return repoInsertProduct({
    publicIdentifier: nanoid(10),
    sku: input.sku,
    productName: input.productName,
    categoryId,
    description: input.description || null,
    originalPrice: input.originalPrice,
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
    currentQuantity: Number(input.currentQuantity),
    supplier: input.supplier || null,
    location: input.location || null,
    notes: input.notes || null,
  });
}

export async function updateProduct(id: string, input: UpdateProductInput): Promise<ProductRow> {
  const existing = await findProductById(id);
  if (!existing) {
    throw new ProductNotFoundError(id);
  }

  const categoryId = await resolveCategoryIdForUpdate(input.categoryName);

  return repoUpdateProduct(id, {
    productName: input.productName,
    categoryId,
    description: input.description || null,
    originalPrice: input.originalPrice,
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
    supplier: input.supplier || null,
    location: input.location || null,
    notes: input.notes || null,
  });
}

export async function archiveProduct(id: string): Promise<ProductRow> {
  const existing = await findProductById(id);
  if (!existing) {
    throw new ProductNotFoundError(id);
  }
  return repoArchiveProduct(id);
}

export async function regenerateProductQr(id: string): Promise<ProductRow> {
  const existing = await findProductById(id);
  if (!existing) {
    throw new ProductNotFoundError(id);
  }
  return regeneratePublicIdentifier(id, nanoid(10));
}
