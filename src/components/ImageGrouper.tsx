import { useState, useEffect } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import './ImageGrouper.css';

interface ImageGrouperProps {
  items: ClothingItem[];
  onGrouped: (items: ClothingItem[]) => void;
  userId?: string;
}

// Categories for drag-and-drop categorization
const CATEGORIES = [
  'sweatshirts',
  'outerwear',
  'tees',
  'bottoms',
  'femme',
  'hats',
  'mystery boxes'
];

const ImageGrouper: React.FC<ImageGrouperProps> = ({ items, onGrouped, userId }) => {
  const [groupedItems, setGroupedItems] = useState<ClothingItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<ClothingItem | null>(null);
  const [draggedFromGroup, setDraggedFromGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [groupCounter, setGroupCounter] = useState(1);
  const [uploadedImages, setUploadedImages] = useState<Set<string>>(new Set());

  // Initialize items with individual groups and auto-upload
  useEffect(() => {
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
      setGroupedItems(initialized);
    };

    initializeItems();
  }, [items.length]);

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
        console.error('Upload error:', error);
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
      console.error('Upload error:', error);
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
  const handleDragStart = (item: ClothingItem, fromGroup: string) => {
    setDraggedItem(item);
    setDraggedFromGroup(fromGroup);
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

  // Drag and Drop for Category Assignment
  const handleCategoryDragOver = (e: React.DragEvent, category: string) => {
    e.preventDefault();
    setDragOverCategory(category);
  };

  const handleCategoryDrop = (e: React.DragEvent, category: string) => {
    e.preventDefault();
    
    if (!draggedItem) {
      setDragOverCategory(null);
      return;
    }

    // Assign category to all images in the group
    const groupId = draggedItem.productGroup || draggedItem.id;
    const updated = groupedItems.map(item =>
      (item.productGroup || item.id) === groupId
        ? { ...item, category }
        : item
    );

    setGroupedItems(updated);
    onGrouped(updated);
    setDraggedItem(null);
    setDraggedFromGroup(null);
    setDragOverCategory(null);
  };

  const handleCategoryDragEnd = () => {
    setDragOverCategory(null);
  };

  // Create new group for drag-and-drop
  const createNewGroup = () => {
    const newGroupId = `group-${groupCounter}`;
    setGroupCounter(groupCounter + 1);
    return newGroupId;
  };

  // Handle drop on "New Group" area
  const handleDropOnNewGroup = (e: React.DragEvent) => {
    e.preventDefault();
    
    if (!draggedItem) return;

    const newGroupId = createNewGroup();
    const updated = groupedItems.map(item =>
      item.id === draggedItem.id
        ? { ...item, productGroup: newGroupId }
        : item
    );

    setGroupedItems(updated);
    onGrouped(updated);
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
        </div>
      </div>

      <div className="grouper-instructions">
        <p>💡 <strong>Drag & Drop Instructions:</strong></p>
        <ul>
          <li>🖱️ Drag images between groups to reorganize</li>
          <li>➕ Drag an image to "Create New Group" to start a new product</li>
          <li>🏷️ Drag groups onto category buttons to categorize</li>
          <li>🗑️ Click the × button to delete unwanted images</li>
        </ul>
      </div>

      {/* Category Zones */}
      <div className="category-zones">
        <h3>🏷️ Drag Groups Here to Categorize</h3>
        <div className="category-grid">
          {CATEGORIES.map(category => (
            <div
              key={category}
              className={`category-zone ${dragOverCategory === category ? 'drag-over' : ''}`}
              onDragOver={(e) => handleCategoryDragOver(e, category)}
              onDrop={(e) => handleCategoryDrop(e, category)}
              onDragLeave={handleCategoryDragEnd}
            >
              <span className="category-icon">
                {category === 'Tops' && '👕'}
                {category === 'Bottoms' && '👖'}
                {category === 'Dresses' && '👗'}
                {category === 'Outerwear' && '🧥'}
                {category === 'Shoes' && '👟'}
                {category === 'Accessories' && '🎩'}
                {category === 'Bags' && '👜'}
                {category === 'Jewelry' && '💍'}
                {category === 'Other' && '📦'}
              </span>
              <span className="category-name">{category}</span>
              <span className="category-count">
                ({groupedItems.filter(i => i.category === category).length})
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-image groups */}
      {multiItemGroups.length > 0 && (
        <div className="groups-section">
          <h3>📦 Product Groups ({multiItemGroups.length})</h3>
          <div className="groups-grid">
            {multiItemGroups.map(([groupId, items]) => (
              <div
                key={groupId}
                className={`product-group-card ${dragOverGroup === groupId ? 'drag-over' : ''}`}
                onDragOver={(e) => handleDragOver(e, groupId)}
                onDrop={(e) => handleDrop(e, groupId)}
                onDragLeave={handleDragEnd}
              >
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
                      className="group-image-item"
                      draggable
                      onDragStart={() => handleDragStart(item, groupId)}
                      onDragEnd={handleDragEnd}
                    >
                      <img src={item.preview} alt="Product" />
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

      {/* Single items */}
      {singleItems.length > 0 && (
        <div className="singles-section">
          <h3>📄 Individual Items ({singleItems.length})</h3>
          <div className="items-grid">
            {singleItems.map((item) => {
              const itemGroupId = item.productGroup || item.id;
              return (
                <div
                  key={item.id}
                  className={`single-item-card ${dragOverGroup === itemGroupId ? 'drag-over' : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(item, itemGroupId)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, itemGroupId)}
                  onDrop={(e) => handleDrop(e, itemGroupId)}
                >
                  <img src={item.preview} alt="Product" />
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

      {/* New Group Drop Zone */}
      <div
        className={`new-group-zone ${dragOverGroup === 'new' ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverGroup('new');
        }}
        onDrop={handleDropOnNewGroup}
        onDragLeave={() => setDragOverGroup(null)}
      >
        <div className="new-group-content">
          <span className="new-group-icon">➕</span>
          <span>Drag an image here to create a new product group</span>
        </div>
      </div>
    </div>
  );
};

export default ImageGrouper;
