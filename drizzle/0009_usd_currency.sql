CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"rate_date" date NOT NULL,
	"source" text NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "retail_price_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_currency" text DEFAULT 'UZS' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "retail_price_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "amount_usd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "usd_rate" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_rates_currency_created_idx" ON "exchange_rates" USING btree ("currency","created_at");