import {
  pgTable,
  pgEnum,
  pgSequence,
  uuid,
  text,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "USER"]);
export const productStatusEnum = pgEnum("product_status", ["ACTIVE", "ARCHIVED"]);
export const inventoryTransactionTypeEnum = pgEnum("inventory_transaction_type", [
  "PURCHASE",
  "SALE",
  "RETURN",
  "ADJUSTMENT",
  "DAMAGE",
  "OTHER",
]);
export const saleStatusEnum = pgEnum("sale_status", ["COMPLETED", "CANCELLED", "PARTIALLY_RETURNED", "RETURNED"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("USER"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("categories_name_idx").on(table.name),
]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicIdentifier: varchar("public_identifier", { length: 32 }).notNull(),
  sku: varchar("sku", { length: 64 }).notNull(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id),
  description: text("description"),
  productImage: text("product_image"),
  originalPrice: numeric("original_price", { precision: 12, scale: 2 }).notNull(),
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }).notNull(),
  sellingPrice: numeric("selling_price", { precision: 12, scale: 2 }),
  currentQuantity: integer("current_quantity").notNull().default(0),
  supplier: varchar("supplier", { length: 255 }),
  location: varchar("location", { length: 255 }),
  status: productStatusEnum("status").notNull().default("ACTIVE"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("products_public_identifier_idx").on(table.publicIdentifier),
  uniqueIndex("products_sku_idx").on(table.sku),
  index("products_product_name_idx").on(table.productName),
  check("products_quantity_non_negative", sql`${table.currentQuantity} >= 0`),
]);

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  type: inventoryTransactionTypeEnum("type").notNull(),
  quantity: integer("quantity").notNull(),
  referenceId: uuid("reference_id"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("inventory_transactions_product_id_idx").on(table.productId),
]);

export const saleNumberSeq = pgSequence("sale_number_seq", { startWith: 1 });

export const sales = pgTable("sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleNumber: varchar("sale_number", { length: 32 }).notNull(),
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull().defaultNow(),
  soldBy: uuid("sold_by").notNull().references(() => users.id),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).notNull(),
  totalProfit: numeric("total_profit", { precision: 12, scale: 2 }).notNull(),
  status: saleStatusEnum("status").notNull().default("COMPLETED"),
  notes: text("notes"),
  buyerName: text("buyer_name"),
  buyerPhone: text("buyer_phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sales_sale_number_idx").on(table.saleNumber),
  index("sales_sold_at_idx").on(table.soldAt),
]);

export const saleItems = pgTable("sale_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleId: uuid("sale_id").notNull().references(() => sales.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  costPerUnit: numeric("cost_per_unit", { precision: 12, scale: 2 }).notNull(),
  soldPricePerUnit: numeric("sold_price_per_unit", { precision: 12, scale: 2 }).notNull(),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).notNull(),
  totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).notNull(),
  profit: numeric("profit", { precision: 12, scale: 2 }).notNull(),
  returnedQuantity: integer("returned_quantity").notNull().default(0),
}, (table) => [
  index("sale_items_sale_id_idx").on(table.saleId),
  index("sale_items_product_id_idx").on(table.productId),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
