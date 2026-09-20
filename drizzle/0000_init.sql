CREATE TYPE "public"."inventory_transaction_type" AS ENUM('PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('COMPLETED', 'CANCELLED', 'RETURNED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'USER');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "inventory_transaction_type" NOT NULL,
	"quantity" integer NOT NULL,
	"reference_id" uuid,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_identifier" varchar(32) NOT NULL,
	"sku" varchar(64) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"category_id" uuid,
	"description" text,
	"product_image" text,
	"original_price" numeric(12, 2) NOT NULL,
	"cost_price" numeric(12, 2) NOT NULL,
	"selling_price" numeric(12, 2),
	"current_quantity" integer DEFAULT 0 NOT NULL,
	"supplier" varchar(255),
	"location" varchar(255),
	"status" "product_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_quantity_non_negative" CHECK ("products"."current_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"cost_per_unit" numeric(12, 2) NOT NULL,
	"sold_price_per_unit" numeric(12, 2) NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"total_revenue" numeric(12, 2) NOT NULL,
	"profit" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_number" varchar(32) NOT NULL,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sold_by" uuid NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"total_cost" numeric(12, 2) NOT NULL,
	"total_profit" numeric(12, 2) NOT NULL,
	"status" "sale_status" DEFAULT 'COMPLETED' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_idx" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "inventory_transactions_product_id_idx" ON "inventory_transactions" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_public_identifier_idx" ON "products" USING btree ("public_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_product_name_idx" ON "products" USING btree ("product_name");--> statement-breakpoint
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_id_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_sale_number_idx" ON "sales" USING btree ("sale_number");--> statement-breakpoint
CREATE INDEX "sales_sold_at_idx" ON "sales" USING btree ("sold_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");