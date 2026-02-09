-- Fix orphaned product by linking to the correct batch
-- The product 7485606f-94da-4c6e-95a8-81e88ddd47e0 references a deleted batch
-- Let's link it to batch 854d174f-6051-42c8-a43d-e8a217f667a8 (the one with 3 saved images)

UPDATE public.products
SET batch_id = '854d174f-6051-42c8-a43d-e8a217f667a8'
WHERE id = '7485606f-94da-4c6e-95a8-81e88ddd47e0';

-- Verify the update
SELECT 
  id,
  title,
  product_category,
  batch_id,
  (SELECT batch_number FROM workflow_batches WHERE id = products.batch_id) as batch_number
FROM public.products
WHERE id = '7485606f-94da-4c6e-95a8-81e88ddd47e0';
