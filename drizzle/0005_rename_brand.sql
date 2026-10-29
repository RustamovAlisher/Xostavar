-- Brend nomi: "TEMIR BAZA ERP" -> "OMBOR CONTROL". Faqat standart nom o'zgartirilmagan bo'lsa almashtiriladi.
UPDATE "store_settings" SET "name" = 'OMBOR CONTROL', "version" = "version" + 1 WHERE "name" = 'TEMIR BAZA ERP';
