-- Cleanup: delete orphan workflow_batches created when autoSave fired with batchId=null
-- before session resolved (bug fixed in commit 71b6676).
-- These rows have no workflow_state (NULL or empty object) and were never used.
--
-- Run this in Supabase Dashboard → SQL Editor.
-- Safe: only deletes rows where workflow_state is null or empty.
-- Real batches always have at least { processedItems: [...] } in workflow_state.

-- Preview first (optional):
-- SELECT id, batch_number, created_at, workflow_state
-- FROM workflow_batches
-- WHERE workflow_state IS NULL
--    OR workflow_state = '{}'::jsonb
--    OR workflow_state = '{"uploadedImages":[],"groupedImages":[],"sortedImages":[],"processedItems":[]}'::jsonb;

-- Delete orphans:
DELETE FROM workflow_batches
WHERE workflow_state IS NULL
   OR workflow_state = '{}'::jsonb
   OR (
     workflow_state->>'processedItems' IS NOT NULL
     AND jsonb_array_length(workflow_state->'processedItems') = 0
     AND jsonb_array_length(workflow_state->'uploadedImages') = 0
     AND jsonb_array_length(workflow_state->'groupedImages')  = 0
     AND jsonb_array_length(workflow_state->'sortedImages')   = 0
   );

-- Verify remaining count:
SELECT COUNT(*) AS remaining_batches FROM workflow_batches;
