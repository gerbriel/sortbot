import { useState } from 'react';
import type { ClothingItem } from '../App';
import './CategoryZones.css';

interface CategoryZonesProps {
  items: ClothingItem[];
  onCategorized: (items: ClothingItem[]) => void;
}

const CATEGORIES = [
  'sweatshirts',
  'outerwear',
  'tees',
  'bottoms',
  'femme',
  'hats',
  'mystery boxes'
];

const CategoryZones: React.FC<CategoryZonesProps> = ({ items, onCategorized }) => {
  const [draggedItem, setDraggedItem] = useState<ClothingItem | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, item: ClothingItem) => {
    setDraggedItem(item);
    // Set data for drag operation
    e.dataTransfer.setData('application/json', JSON.stringify({
      item,
      productGroup: item.productGroup || item.id
    }));
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverCategory(null);
  };

  const handleCategoryDragOver = (e: React.DragEvent, category: string) => {
    e.preventDefault();
    setDragOverCategory(category);
  };

  const handleCategoryDrop = (e: React.DragEvent, category: string) => {
    e.preventDefault();
    
    let productGroup: string | undefined;
    
    // Try to get data from dataTransfer (for drags from Step 2)
    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const dragData = JSON.parse(data);
        productGroup = dragData.productGroup;
      }
    } catch (err) {
      // If parsing fails, fall back to draggedItem
    }
    
    // Fall back to local draggedItem state (for drags within Step 3)
    if (!productGroup && draggedItem) {
      productGroup = draggedItem.productGroup || draggedItem.id;
    }
    
    if (!productGroup) return;

    // Update all items in the same product group with the category
    const updated = items.map(item => {
      const itemGroup = item.productGroup || item.id;
      return itemGroup === productGroup
        ? { ...item, category }
        : item;
    });

    console.log('🏷️ CategoryZones: Categorized items:', updated.filter(i => i.category).map(i => ({ id: i.id, category: i.category, productGroup: i.productGroup })));

    onCategorized(updated);
    setDraggedItem(null);
    setDragOverCategory(null);
  };

  const handleCategoryDragLeave = () => {
    setDragOverCategory(null);
  };

  // Group items by productGroup
  const getGroups = () => {
    const groups: { [key: string]: ClothingItem[] } = {};
    items.forEach(item => {
      const groupId = item.productGroup || item.id;
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(item);
    });
    return groups;
  };

  const groups = getGroups();
  const groupEntries = Object.entries(groups);
  // Show ALL groups (including single items as their own product groups)
  const allProductGroups = groupEntries;

  return (
    <div className="category-zones-container">
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
              onDragLeave={handleCategoryDragLeave}
            >
              <span className="category-icon">
                {category === 'sweatshirts' && '🧥'}
                {category === 'outerwear' && '🧥'}
                {category === 'tees' && '👕'}
                {category === 'bottoms' && '👖'}
                {category === 'femme' && '👗'}
                {category === 'hats' && '🧢'}
                {category === 'mystery boxes' && '📦'}
              </span>
              <span className="category-name">{category}</span>
              <span className="category-count">
                ({items.filter(i => i.category === category).length})
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* All Product Groups (including single items) */}
      {allProductGroups.length > 0 && (
        <div className="groups-section">
          <h3>📦 All Product Groups ({allProductGroups.length})</h3>
          <div className="groups-grid">
            {allProductGroups.map(([groupId, groupItems]) => (
              <div
                key={groupId}
                className={`product-group-card ${groupItems[0].category ? 'has-category' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, groupItems[0])}
                onDragEnd={handleDragEnd}
              >
                {groupItems[0].category && (
                  <div className="category-indicator">
                    <span className="category-check">✓</span>
                    <span className="category-label">{groupItems[0].category}</span>
                  </div>
                )}
                <div className="group-header">
                  <span className="group-badge">
                    {groupItems.length} {groupItems.length === 1 ? 'image' : 'images'}
                  </span>
                  {groupItems[0].category && (
                    <span className="category-badge">{groupItems[0].category}</span>
                  )}
                </div>
                <div className="group-images">
                  {groupItems.map((item) => (
                    <div
                      key={item.id}
                      className="group-image-item"
                    >
                      <img src={item.preview} alt="Product" />
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

export default CategoryZones;
