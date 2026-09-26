ALTER TYPE "public"."sale_status" ADD VALUE 'PARTIALLY_RETURNED' BEFORE 'RETURNED';--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "returned_quantity" integer DEFAULT 0 NOT NULL;