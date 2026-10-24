DROP INDEX "customers_name_idx";--> statement-breakpoint
CREATE INDEX "login_attempts_time_idx" ON "login_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "product_barcodes_trgm_idx" ON "product_barcodes" USING gin (lower("barcode") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_variants_name_trgm_idx" ON "product_variants" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_variants_sku_trgm_idx" ON "product_variants" USING gin (lower("sku") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_sku_trgm_idx" ON "products" USING gin (lower("sku") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_debtors_idx" ON "customers" USING btree ("total_debt") WHERE "customers"."total_debt" > 0;