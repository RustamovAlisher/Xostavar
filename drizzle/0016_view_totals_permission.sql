-- Yangi huquq `view_totals`: umumiy savdo/kassa summalari (Sotuvlar sahifasi) va ombor qiymati.
-- Hozirgi imkoniyat saqlansin: hisobot ko'ra oladigan rollar va xodimlar (yoki «barcha filial» egasi) shu huquqni oladi.
UPDATE "roles" SET "permissions" = array_append("permissions", 'view_totals')
WHERE NOT ('view_totals' = ANY("permissions")) AND ('view_analytics' = ANY("permissions") OR "all_branches");--> statement-breakpoint
UPDATE "users" SET "permissions" = array_append("permissions", 'view_totals')
WHERE NOT ('view_totals' = ANY("permissions"))
  AND ('view_analytics' = ANY("permissions") OR "role_id" IN (SELECT "id" FROM "roles" WHERE "all_branches"));
