-- Yangi huquqlar: view_all_sales (hamma kassirlarning cheklarini ko'rish) va void_sale (chekni bekor qilish).
-- Avval shu amallar view_analytics / manage_users bilan ruxsat etilgan edi: mavjud rol va xodimlar o'z imkoniyatini yo'qotmasin.
UPDATE "roles" SET "permissions" = array_append("permissions", 'view_all_sales') WHERE ("permissions" && ARRAY['view_analytics', 'manage_users']) AND NOT ('view_all_sales' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'void_sale') WHERE 'manage_users' = ANY("permissions") AND NOT ('void_sale' = ANY("permissions"));--> statement-breakpoint
UPDATE "users" SET "permissions" = array_append("permissions", 'view_all_sales') WHERE ("permissions" && ARRAY['view_analytics', 'manage_users']) AND NOT ('view_all_sales' = ANY("permissions"));--> statement-breakpoint
UPDATE "users" SET "permissions" = array_append("permissions", 'void_sale') WHERE 'manage_users' = ANY("permissions") AND NOT ('void_sale' = ANY("permissions"));
