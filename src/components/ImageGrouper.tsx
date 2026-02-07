import { useState, useEffect } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import './ImageGrouper.css';

interface ImageGrouperProps {
  items: ClothingItem[];
  onGrouped: (items: ClothingItem[]) => void;
  userId?: string;
}

const ImageGrouper: React.FC<ImageGrouperProps> = ({ items, onGrouped, userId }) => {
  const [groupedItems, setGroupedItems] = useState<ClothingItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<ClothingItem | null>(null);
  const [draggedFromGroup, setDraggedFromGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [groupCounter, setGroupCounter] = useState(1);
  const [uploadedImages, setUploadedImages] = useState<Set<string>>(new Set());

  // Initialize items with individual groups and auto-upload
  useEffect(() => {
    console.log('🎨 ImageGrouper received items:', items.map(i => ({ id: i.id, category: i.category, productGroup: i.productGroup })));
    
    const initializeItems = async () => {
      const initialized = await Promise.all(
        items.map(async (item) => {
          // Check if already uploaded
          if (uploadedImages.has(item.id)) {
            return { ...item, productGroup: item.productGroup || item.id };
          }

          // Upload to Supabase Storage immediately
          if (userId && item.file) {
            const uploaded = await uploadImageImmediately(item, userId);
            if (uploaded) {
              setUploadedImages(prev => new Set(prev).add(item.id));
              return { ...uploaded, productGroup: uploaded.productGroup || uploaded.id };
            }
          }
          
          return { ...item, productGroup: item.productGroup || item.id };
        })
      );
      console.log('🎨 ImageGrouper initialized items:', initialized.map(i => ({ id: i.id, category: i.category, productGroup: i.productGroup })));
      setGroupedItems(initialized);
    };

    initializeItems();
  }, [items]);

  // Auto-upload image to Supabase Storage
  const uploadImageImmediately = async (item: ClothingItem, userId: string) => {
    try {
      const fileExt = item.file.name.split('.').pop();
      const fileName = `${item.id}_${Date.now()}.${fileExt}`;
      const filePath = `${userId}/temp/${fileName}`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(filePath, item.file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        console.error('Upload failed:', error.message);
        return item;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(data.path);

      return {
        ...item,
        preview: publicUrl,
        imageUrls: [publicUrl],
        storagePath: data.path,
      };
    } catch (error) {
      console.error('Upload failed:', error);
      return item;
    }
  };

  // Delete image from Supabase Storage
  const deleteImageFromStorage = async (storagePath?: string) => {
    if (!storagePath) return;
    
    try {
      await supabase.storage
        .from('product-images')
        .remove([storagePath]);
      console.log('✅ Deleted from storage:', storagePath);
    } catch (error) {
      console.error('Storage delete error:', error);
    }
  };

  const getGroups = () => {
    const groups: Record<string, ClothingItem[]> = {};
    groupedItems.forEach(item => {
      const groupId = item.productGroup || item.id;
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(item);
    });
    return groups;
  };

  // Click-to-Select functionality
  const toggleItemSelection = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  // Create group from selected items
  const createGroupFromSelected = () => {
    if (selectedItems.size < 2) {
      alert('Please select at least 2 items to group together');
      return;
    }

    const groupId = `group-${groupCounter}`;
    const updated = groupedItems.map(item =>
      selectedItems.has(item.id)
        ? { ...item, productGroup: groupId }
        : item
    );

    setGroupedItems(updated);
    setSelectedItems(new Set());
    setGroupCounter(groupCounter + 1);
    onGrouped(updated);
  };

  // Ungroup selected items
  const ungroupSelected = () => {
    if (selectedItems.size === 0) {
      alert('Please select items to ungroup');
      return;
    }

    const updated = groupedItems.map(item =>
      selectedItems.has(item.id)
        ? { ...item, productGroup: item.id, category: undefined }
        : item
    );

    setGroupedItems(updated);
    setSelectedItems(new Set());
    onGrouped(updated);
  };


  // Drag and Drop Handlers for Images
  const handleDragStart = (e: React.DragEvent, item: ClothingItem, fromGroup: string) => {
    setDraggedItem(item);
    setDraggedFromGroup(fromGroup);
    // Set data for cross-component dragging (Step 2 -> Step 3)
    e.dataTransfer.setData('application/json', JSON.stringify({
      item,
      productGroup: item.productGroup || item.id
    }));
  };

  const handleDragOver = (e: React.DragEvent, targetGroup: string) => {
    e.preventDefault();
    setDragOverGroup(targetGroup);
  };

  const handleDrop = (e: React.DragEvent, targetGroup: string) => {
    e.preventDefault();
    
    if (!draggedItem || draggedFromGroup === targetGroup) {
      setDragOverGroup(null);
      return;
    }

    // Move image to target group
    const updated = groupedItems.map(item =>
      item.id === draggedItem.id
        ? { ...item, productGroup: targetGroup }
        : item
    );

    setGroupedItems(updated);
    onGrouped(updated);
    setDraggedItem(null);
    setDraggedFromGroup(null);
    setDragOverGroup(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDraggedFromGroup(null);
    setDragOverGroup(null);
  };

  // Delete image handler
  const handleDeleteImage = async (item: ClothingItem) => {
    if (!confirm('Delete this image? This cannot be undone.')) return;

    // Delete from storage if it was uploaded
    if (item.storagePath) {
      await deleteImageFromStorage(item.storagePath);
    }

    // Remove from UI
    const updated = groupedItems.filter(i => i.id !== item.id);
    setGroupedItems(updated);
    onGrouped(updated);
    setUploadedImages(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  };

  const groups = getGroups();
  const groupEntries = Object.entries(groups);
  const multiItemGroups = groupEntries.filter(([_, items]) => items.length > 1);
  const singleItems = groupEntries.filter(([_, items]) => items.length === 1).flatMap(([_, items]) => items);

  return (
    <div className="image-grouper-container">
      <div className="grouper-header">
        <div className="stats">
          <span>📦 {multiItemGroups.length} Product Groups</span>
          <span>📄 {singleItems.length} Single Items</span>
          <span>🖼️ {groupedItems.length} Total Images</span>
          {selectedItems.size > 0 && (
            <span style={{ background: '#10b981' }}>✓ {selectedItems.size} Selected</span>
          )}
        </div>
      </div>

      {/* Grouping Controls */}
      <div className="grouper-actions">
        <button 
          className="button button-primary" 
          onClick={createGroupFromSelected}
          disabled={selectedItems.size < 2}
        >
          🔗 Group Selected ({selectedItems.size})
        </button>
        <button 
          className="button button-secondary" 
          onClick={ungroupSelected}
          disabled={selectedItems.size === 0}
        >
          ✂️ Ungroup Selected
        </button>
        <button 
          className="button button-secondary" 
          onClick={() => setSelectedItems(new Set())}
          disabled={selectedItems.size === 0}
        >
          ❌ Clear Selection
        </button>
      </div>

      {singleItems.length > 0 && (
        <div className="singles-section">
          <h3>� Individual Items ({singleItems.length})</h3>
          <div className="items-grid">
            {singleItems.map((item) => {
              const itemGroupId = item.productGroup || item.id;
              return (
                <div
                  key={item.id}
                  className={`single-item-card ${dragOverGroup === itemGroupId ? 'drag-over' : ''} ${item.category ? 'has-category' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item, itemGroupId)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, itemGroupId)}
                  onDrop={(e) => handleDrop(e, itemGroupId)}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('.delete-image-btn')) {
                      toggleItemSelection(item.id);
                    }
                  }}
                >
                  {item.category && (
                    <div className="category-indicator-small">
                      <span className="category-check">✓</span>
                    </div>
                  )}
                  <img src={item.preview} alt="Product" />
                  {selectedItems.has(item.id) && (
                    <div className="selection-indicator">✓</div>
                  )}
                  <button
                    className="delete-image-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteImage(item);
                    }}
                    title="Delete image"
                  >
                    ×
                  </button>
                  {item.category && (
                    <div className="item-info">
                      <span className="category-badge">{item.category}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Product Groups */}
      {multiItemGroups.length > 0 && (
        <div className="groups-section">
          <h3>📦 Product Groups ({multiItemGroups.length})</h3>
          <div className="groups-grid">
            {multiItemGroups.map(([groupId, items]) => (
              <div
                key={groupId}
                className={`product-group-card ${dragOverGroup === groupId ? 'drag-over' : ''} ${items[0].category ? 'has-category' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, items[0], groupId)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, groupId)}
                onDrop={(e) => handleDrop(e, groupId)}
                onDragLeave={handleDragEnd}
              >
                {items[0].category && (
                  <div className="category-indicator">
                    <span className="category-check">✓</span>
                    <span className="category-label">{items[0].category}</span>
                  </div>
                )}
                <div className="group-header">
                  <span className="group-badge">
                    {items.length} images
                  </span>
                  {items[0].category && (
                    <span className="category-badge">{items[0].category}</span>
                  )}
                </div>
                <div className="group-images">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`group-image-item ${selectedItems.has(item.id) ? 'selected' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item, groupId)}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest('.delete-image-btn')) {
                          toggleItemSelection(item.id);
                        }
                      }}
                    >
                      <img src={item.preview} alt="Product" />
                      {selectedItems.has(item.id) && (
                        <div className="selection-indicator">✓</div>
                      )}
                      <button
                        className="delete-image-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteImage(item);
                        }}
                        title="Delete image"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageGrouper;
