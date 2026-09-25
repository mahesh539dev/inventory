CREATE SEQUENCE "public"."sale_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "buyer_name" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "buyer_phone" text;