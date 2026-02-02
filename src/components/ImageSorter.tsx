import { useState, useMemo } from 'react';
import type { ClothingItem } from '../App';
import './ImageSorter.css';

interface ImageSorterProps {
  images: ClothingItem[];
  onSorted: (items: ClothingItem[]) => void;
}

const CATEGORIES = [
  'Sweatshirts',
  'Outerwear',
  'Tees',
  'Bottoms',
  'Femme',
  'Hats',
  'Mystery Boxes',
  'Accessories',
  'Activewear',
  'Other'
];

const ImageSorter: React.FC<ImageSorterProps> = ({ images, onSorted }) => {
  const [sortedItems, setSortedItems] = useState<ClothingItem[]>(images);

  // Group items by productGroup
  const itemGroups = useMemo(() => {
    const groups: Record<string, ClothingItem[]> = {};
    
    sortedItems.forEach(item => {
      const groupId = item.productGroup || item.id; // Use item.id if not grouped
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(item);
    });
    
    return Object.values(groups);
  }, [sortedItems]);

  const handleCategorySelect = (groupId: string, category: string) => {
    const updated = sortedItems.map(item => {
      // If this item belongs to the selected group, update its category
      const itemGroupId = item.productGroup || item.id;
      return itemGroupId === groupId ? { ...item, category } : item;
    });
    setSortedItems(updated);
  };

  const handleFinishSorting = () => {
    const allCategorized = sortedItems.every(item => item.category);
    if (allCategorized) {
      onSorted(sortedItems);
    } else {
      alert('Please categorize all items/groups before proceeding');
    }
  };

  return (
    <div className="image-sorter-container">
      <p className="sorter-info">
        📦 Showing {itemGroups.length} product group(s) to categorize
        {itemGroups.length < sortedItems.length && ` (${sortedItems.length} total images)`}
      </p>
      
      <div className="items-grid">
        {itemGroups.map((group) => {
          const representativeItem = group[0];
          const groupId = representativeItem.productGroup || representativeItem.id;
          const isGroup = group.length > 1;
          
          return (
            <div key={groupId} className="item-card">
              <img src={representativeItem.preview} alt="Product" className="item-image" />
              {isGroup && (
                <div className="group-badge">
                  📦 Group of {group.length}
                </div>
              )}
              <div className="item-controls">
                <label htmlFor={`category-${groupId}`}>
                  {isGroup ? 'Group Category:' : 'Category:'}
                </label>
                <select
                  id={`category-${groupId}`}
                  value={representativeItem.category || ''}
                  onChange={(e) => handleCategorySelect(groupId, e.target.value)}
                  className="category-select"
                >
                  <option value="">Select category...</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sorter-footer">
        <button 
          className="button" 
          onClick={handleFinishSorting}
          disabled={!sortedItems.every(item => item.category)}
        >
          Continue to Descriptions →
        </button>
      </div>
    </div>
  );
};

export default ImageSorter;
