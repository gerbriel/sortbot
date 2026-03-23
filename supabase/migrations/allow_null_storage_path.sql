-- Allow storage_path to be NULL in product_images.
-- Legacy items created via URL upload (not direct file upload) have imageUrls
-- but no storagePath. The NOT NULL constraint was blocking all product_images
-- upserts for these items, silently writing 0 rows.
ALTER TABLE product_images ALTER COLUMN storage_path DROP NOT NULL;
