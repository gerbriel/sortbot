# Export Library System

## Overview
The Export Library is a comprehensive system for tracking, managing, and reviewing CSV exports before and after sending to Shopify. Each export is saved as a "batch" with complete CSV data, metadata, and status tracking.

---

## Database Schema

### `export_batches` Table
Stores metadata about each CSV export.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Reference to auth.users |
| `batch_name` | TEXT | User-friendly name (e.g., "Winter 2026 Collection") |
| `batch_number` | INTEGER | Auto-incrementing per user (1, 2, 3...) |
| `description` | TEXT | Optional description |
| `product_count` | INTEGER | Number of products in export |
| `total_value` | NUMERIC | Sum of all product prices |
| `csv_file_name` | TEXT | Generated filename (e.g., "shopify_export_batch1_2026-02-07.csv") |
| `csv_storage_path` | TEXT | Path in Supabase Storage (optional) |
| `file_size_bytes` | BIGINT | CSV file size |
| `status` | TEXT | Export lifecycle status |
| `shopify_import_id` | TEXT | Shopify bulk import ID |
| `shopify_status` | TEXT | Shopify processing status |
| `shopify_error_message` | TEXT | Any errors from Shopify |
| `shopify_imported_count` | INTEGER | Successfully imported count |
| `shopify_failed_count` | INTEGER | Failed import count |
| `created_at` | TIMESTAMPTZ | When batch was created |
| `exported_at` | TIMESTAMPTZ | When CSV was downloaded |
| `uploaded_at` | TIMESTAMPTZ | When uploaded to Shopify |
| `completed_at` | TIMESTAMPTZ | When Shopify confirmed success |
| `updated_at` | TIMESTAMPTZ | Last update time |
| `tags` | TEXT[] | User-defined tags for organization |
| `notes` | TEXT | User notes |

### `export_batch_items` Table
Stores the actual CSV row data for each product.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `export_batch_id` | UUID | Reference to export_batches |
| `product_id` | UUID | Reference to products table (optional) |
| `row_number` | INTEGER | Position in CSV (1, 2, 3...) |
| `csv_data` | JSONB | Complete 62-column CSV row as JSON |
| `title` | TEXT | Quick-access product title |
| `handle` | TEXT | Quick-access URL handle |
| `vendor` | TEXT | Quick-access brand/vendor |
| `product_type` | TEXT | Quick-access product type |
| `price` | NUMERIC | Quick-access price |
| `sku` | TEXT | Quick-access SKU |
| `status` | TEXT | Item status (pending, exported, imported, failed) |
| `shopify_product_id` | TEXT | Shopify product ID after import |
| `shopify_error` | TEXT | Error message if import failed |
| `created_at` | TIMESTAMPTZ | When item was added |

---

## Export Lifecycle

```
┌─────────────┐
│   PENDING   │  Batch created, items added
└──────┬──────┘
       │
       ↓ (User clicks "Export to CSV")
┌─────────────┐
│  EXPORTED   │  CSV downloaded by user
└──────┬──────┘
       │
       ↓ (User uploads to Shopify)
┌─────────────┐
│  UPLOADED   │  CSV uploaded to Shopify dashboard
└──────┬──────┘
       │
       ↓ (Shopify processes import)
┌─────────────┐
│ PROCESSING  │  Shopify is importing products
└──────┬──────┘
       │
       ↓ (Shopify confirms completion)
┌─────────────┐
│ COMPLETED   │  All products successfully imported ✓
└─────────────┘
       │
       ↓ (If there were errors)
┌─────────────┐
│   FAILED    │  Some/all products failed to import
└─────────────┘
       │
       ↓ (After 90 days or manual action)
┌─────────────┐
│  ARCHIVED   │  Old export, kept for records
└─────────────┘
```

---

## Workflow Integration

### Current Flow (Before Export Library)
```
Step 1: Upload Images
Step 2: Group Images
Step 3: Assign Categories (with presets)
Step 4: Voice Description + AI Generation
Step 5: Export to CSV (download file)
❌ No history, can't re-download, no tracking
```

### New Flow (With Export Library)
```
Step 1: Upload Images
Step 2: Group Images
Step 3: Assign Categories (with presets)
Step 4: Voice Description + AI Generation
Step 5: Export to CSV
  ↓
  [Export Library]
  • Create batch: "Winter Collection - Feb 2026"
  • Save all 62 CSV columns per product
  • Generate batch #42 automatically
  • Track status: PENDING → EXPORTED
  ↓
✅ Can review batch before uploading
✅ Can re-download CSV anytime
✅ Can see exactly what was exported
✅ Can track Shopify import status
✅ Complete audit trail
```

---

## Usage Examples

### 1. Export Products to New Batch

```typescript
import { 
  createExportBatch, 
  addItemsToExportBatch,
  markBatchExported 
} from './lib/exportLibraryService';
import { generateCSVFromProducts } from './components/GoogleSheetExporter';

// When user clicks "Export to CSV"
const handleExportToLibrary = async (products: ClothingItem[]) => {
  // 1. Create batch
  const batch = await createExportBatch({
    userId: user.id,
    batchName: `Export - ${new Date().toLocaleDateString()}`,
    description: 'Vintage winter collection',
    tags: ['winter-2026', 'vintage', 'ready-to-list'],
    notes: 'Remember to check sizes before uploading',
  });

  if (!batch) {
    alert('Failed to create export batch');
    return;
  }

  // 2. Add items to batch
  const success = await addItemsToExportBatch(
    batch.id,
    products,
    (product) => generateCSVRow(product) // Your existing CSV mapper
  );

  if (!success) {
    alert('Failed to add products to batch');
    return;
  }

  // 3. Generate and download CSV
  const csv = generateCSVFromProducts(products);
  downloadCSV(csv, batch.csv_file_name);

  // 4. Mark as exported
  await markBatchExported(batch.id);

  alert(`✅ Exported ${products.length} products to batch #${batch.batch_number}`);
};
```

### 2. View Export Library

```typescript
import { fetchUserExportBatches } from './lib/exportLibraryService';

const ExportLibrary = ({ userId }) => {
  const [batches, setBatches] = useState([]);

  useEffect(() => {
    loadBatches();
  }, []);

  const loadBatches = async () => {
    const data = await fetchUserExportBatches(userId);
    setBatches(data);
  };

  return (
    <div className="export-library">
      <h2>Export Library</h2>
      {batches.map(batch => (
        <div key={batch.id} className="batch-card">
          <div className="batch-header">
            <h3>#{batch.batch_number} - {batch.batch_name}</h3>
            <span className={`status ${batch.status}`}>
              {batch.status}
            </span>
          </div>
          <div className="batch-stats">
            <span>📦 {batch.product_count} products</span>
            <span>💰 ${batch.total_value.toFixed(2)}</span>
            <span>📅 {new Date(batch.created_at).toLocaleDateString()}</span>
          </div>
          {batch.tags && batch.tags.length > 0 && (
            <div className="batch-tags">
              {batch.tags.map(tag => (
                <span key={tag} className="tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
```

### 3. Review Batch Before Upload

```typescript
import { fetchExportBatchWithItems } from './lib/exportLibraryService';

const BatchReview = ({ batchId }) => {
  const [batch, setBatch] = useState(null);

  useEffect(() => {
    loadBatch();
  }, [batchId]);

  const loadBatch = async () => {
    const data = await fetchExportBatchWithItems(batchId);
    setBatch(data);
  };

  if (!batch) return <div>Loading...</div>;

  return (
    <div className="batch-review">
      <h2>Review Batch #{batch.batch_number}</h2>
      <div className="batch-summary">
        <p><strong>Name:</strong> {batch.batch_name}</p>
        <p><strong>Products:</strong> {batch.product_count}</p>
        <p><strong>Total Value:</strong> ${batch.total_value.toFixed(2)}</p>
        <p><strong>Status:</strong> {batch.status}</p>
      </div>

      <h3>Products in this batch:</h3>
      <table className="batch-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Vendor</th>
            <th>Type</th>
            <th>Price</th>
            <th>SKU</th>
          </tr>
        </thead>
        <tbody>
          {batch.items.map(item => (
            <tr key={item.id}>
              <td>{item.row_number}</td>
              <td>{item.title}</td>
              <td>{item.vendor}</td>
              <td>{item.product_type}</td>
              <td>${item.price}</td>
              <td>{item.sku}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="batch-actions">
        <button onClick={handleRedownload}>
          📥 Re-download CSV
        </button>
        <button onClick={handleMarkUploaded}>
          ✅ Mark as Uploaded to Shopify
        </button>
      </div>
    </div>
  );
};
```

### 4. Re-download CSV from Batch

```typescript
import { regenerateCSVFromBatch } from './lib/exportLibraryService';

const handleRedownloadCSV = async (batchId: string, fileName: string) => {
  const csvContent = await regenerateCSVFromBatch(batchId);
  
  if (!csvContent) {
    alert('Failed to regenerate CSV');
    return;
  }

  // Download file
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);

  alert('✅ CSV re-downloaded successfully');
};
```

### 5. Search Batches by Tags

```typescript
import { searchExportBatchesByTags } from './lib/exportLibraryService';

const handleSearchByTags = async (userId: string, tags: string[]) => {
  const batches = await searchExportBatchesByTags(userId, tags);
  console.log(`Found ${batches.length} batches with tags:`, tags);
  return batches;
};

// Example: Find all winter collections
const winterBatches = await handleSearchByTags(userId, ['winter-2026']);

// Example: Find all vintage items ready to list
const vintageBatches = await handleSearchByTags(userId, ['vintage', 'ready-to-list']);
```

### 6. Update Shopify Status

```typescript
import { updateExportBatchStatus } from './lib/exportLibraryService';

// After uploading to Shopify
await updateExportBatchStatus(batchId, 'uploaded');

// After Shopify starts processing
await updateExportBatchStatus(batchId, 'processing', {
  shopifyImportId: 'gid://shopify/BulkOperation/1234567890',
  shopifyStatus: 'RUNNING',
});

// After Shopify completes
await updateExportBatchStatus(batchId, 'completed', {
  shopifyStatus: 'COMPLETED',
  shopifyImportedCount: 45,
  shopifyFailedCount: 0,
});

// If there were failures
await updateExportBatchStatus(batchId, 'failed', {
  shopifyStatus: 'COMPLETED',
  shopifyImportedCount: 42,
  shopifyFailedCount: 3,
  shopifyErrorMessage: '3 products failed: invalid SKU format',
});
```

---

## Benefits

### For Users
- ✅ **Never lose an export** - All CSV data is saved
- ✅ **Re-download anytime** - Regenerate CSV from stored data
- ✅ **Review before upload** - Check products before sending to Shopify
- ✅ **Track status** - Know exactly what's been uploaded and imported
- ✅ **Organize exports** - Use tags and notes for easy management
- ✅ **Audit trail** - Complete history of all exports
- ✅ **Quick search** - Find exports by tags, dates, or product names

### For Business Operations
- 📊 **Export analytics** - Track total products exported, value, success rates
- 📈 **Trend analysis** - See which product types are exported most
- 🔍 **Error tracking** - Identify patterns in failed imports
- 📅 **Batch scheduling** - Plan exports by collection or season
- 💼 **Multi-user support** - Each user has their own export library
- 🔐 **Data security** - All data protected by RLS policies

---

## Database Migrations

### Step 1: Run Migration
```bash
# In Supabase Dashboard → SQL Editor
# Paste contents of: supabase/migrations/export_library.sql
# Click "Run"
```

### Step 2: Verify Tables Created
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('export_batches', 'export_batch_items');
```

### Step 3: Test Functions
```sql
-- Test batch number generation
SELECT get_next_batch_number('your-user-id');

-- Should return: 1 (or next available number)
```

---

## Future Enhancements

### Phase 2
- [ ] **Shopify API Integration** - Auto-upload CSVs via Shopify API
- [ ] **Webhook Integration** - Receive Shopify import status updates
- [ ] **Batch Comparison** - Compare two exports side-by-side
- [ ] **Export Templates** - Save common export configurations
- [ ] **Scheduled Exports** - Auto-export on schedule (daily, weekly)

### Phase 3
- [ ] **Batch Analytics Dashboard** - Visual charts and trends
- [ ] **Export Recommendations** - AI suggests best times to export
- [ ] **Bulk Operations** - Merge, split, or duplicate batches
- [ ] **Export Sharing** - Share batches with team members
- [ ] **Version Control** - Track changes to products between exports

---

## API Reference

See `src/lib/exportLibraryService.ts` for complete TypeScript API documentation.

### Key Functions
- `createExportBatch()` - Create new export batch
- `addItemsToExportBatch()` - Add CSV rows to batch
- `fetchUserExportBatches()` - Get all user batches
- `fetchExportBatchWithItems()` - Get batch with full CSV data
- `regenerateCSVFromBatch()` - Re-create CSV from stored data
- `markBatchExported()` - Mark batch as downloaded
- `updateExportBatchStatus()` - Update lifecycle status
- `searchExportBatchesByTags()` - Find batches by tags
- `fetchUserExportStats()` - Get export statistics

---

## Support

For issues or questions about the Export Library system, check:
1. This documentation
2. TypeScript types in `exportLibraryService.ts`
3. Database schema in `supabase/migrations/export_library.sql`
4. Integration examples in this guide

Happy exporting! 🚀
