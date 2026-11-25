CREATE TABLE "supplier_products" (
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_products_supplier_id_product_id_pk" PRIMARY KEY("supplier_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_products_product_idx" ON "supplier_products" USING btree ("product_id");--> statement-breakpoint
-- Mavjud kirimlardan: yetkazib beruvchi tanlangan kirimdagi mahsulotlar unga ulanadi (eng birinchi kirim sanasi bilan)
INSERT INTO "supplier_products" ("supplier_id", "product_id", "created_at")
SELECT r."supplier_id", l."product_id", min(r."created_at")
FROM "stock_receipt_lines" l
JOIN "stock_receipts" r ON r."id" = l."receipt_id"
JOIN "products" p ON p."id" = l."product_id"
WHERE r."supplier_id" IS NOT NULL
GROUP BY r."supplier_id", l."product_id"
ON CONFLICT DO NOTHING;
