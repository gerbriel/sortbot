-- Migration: Ensure product_images has an explicit unique INDEX (not just a constraint)
-- PostgREST requires a CREATE UNIQUE INDEX (not just ADD CONSTRAINT UNIQUE) for
-- ON CONFLICT upserts via the REST API. This migration is idempotent.

-- Drop the constraint-based unique (if it exists) and recreate as an explicit index.
-- The UNIQUE constraint implicitly creates an index, but PostgREST needs the index
-- to be directly discoverable. Creating it explicitly with IF NOT EXISTS is safe.

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_product_url_unique
  ON product_images (product_id, image_url);

-- Note: If the constraint "unique_product_image_url" already exists, Postgres will
-- detect that the index covers the same columns and reuse it. This is safe to run
-- even if the constraint exists.
