DROP INDEX "stock_movements_target_time_idx";--> statement-breakpoint
DROP INDEX "debt_ledger_customer_time_idx";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "debt_ledger" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_movements_target_seq_idx" ON "stock_movements" USING btree ("branch_id","product_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_seq_uq" ON "stock_movements" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "debt_ledger_customer_seq_idx" ON "debt_ledger" USING btree ("customer_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "debt_ledger_seq_uq" ON "debt_ledger" USING btree ("seq");