-- Remove the old constraint-based unique that duplicates the explicit index.
-- PostgREST can get confused when two unique constraints cover the same columns.
-- We keep idx_product_images_product_url_unique (explicit CREATE UNIQUE INDEX)
-- and drop unique_product_image_url (implicit from ADD CONSTRAINT UNIQUE).
-- Safe to run even if the constraint doesn't exist (IF EXISTS guard).
ALTER TABLE product_images
  DROP CONSTRAINT IF EXISTS unique_product_image_url;
