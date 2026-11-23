CREATE TABLE "supplier_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"date" date NOT NULL,
	"method_id" uuid,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "total_debt" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "paid_amount" bigint;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "debt_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "debt_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_ledger" ADD CONSTRAINT "supplier_ledger_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ledger" ADD CONSTRAINT "supplier_ledger_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ledger" ADD CONSTRAINT "supplier_ledger_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ledger" ADD CONSTRAINT "supplier_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_ledger_supplier_seq_idx" ON "supplier_ledger" USING btree ("supplier_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_ledger_seq_uq" ON "supplier_ledger" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "supplier_ledger_ref_idx" ON "supplier_ledger" USING btree ("ref_id");--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_debt_supplier_id_suppliers_id_fk" FOREIGN KEY ("debt_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;