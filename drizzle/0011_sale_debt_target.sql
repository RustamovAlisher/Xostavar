ALTER TABLE "sales" ADD COLUMN "debt_sale_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_debt_sale_id_sales_id_fk" FOREIGN KEY ("debt_sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_debt_sale_idx" ON "sales" USING btree ("debt_sale_id") WHERE "sales"."debt_sale_id" is not null;