ALTER TABLE "business_rules" ALTER COLUMN "piece_length_meters" SET DEFAULT 11.7;--> statement-breakpoint
ALTER TABLE "business_rules" ALTER COLUMN "default_cut_length_meters" SET DEFAULT 6;--> statement-breakpoint
ALTER TABLE "business_rules" ALTER COLUMN "default_min_stock" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "business_rules" ALTER COLUMN "vat_pct" SET DEFAULT 12;--> statement-breakpoint
ALTER TABLE "business_rules" ALTER COLUMN "estimated_margin_pct" SET DEFAULT 16;--> statement-breakpoint
ALTER TABLE "stock_levels" ALTER COLUMN "stock" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ALTER COLUMN "cost_per_unit" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ALTER COLUMN "cost_per_base" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ALTER COLUMN "total_cost" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "stock_receipts" ALTER COLUMN "total_cost" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "vat_included" SET DEFAULT 0;