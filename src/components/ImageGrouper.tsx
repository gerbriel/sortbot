import { useState } from 'react';
import type { ClothingItem } from '../App';
import './ImageGrouper.css';

interface ImageGrouperProps {
  items: ClothingItem[];
  onGrouped: (items: ClothingItem[]) => void;
}

const ImageGrouper: React.FC<ImageGrouperProps> = ({ items, onGrouped }) => {
  const [groupedItems, setGroupedItems] = useState<ClothingItem[]>(
    items.map(item => ({ ...item, productGroup: item.id }))
  );
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [groupCounter, setGroupCounter] = useState(1);

  const toggleItemSelection = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const createGroup = () => {
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
    
    // Notify parent immediately of grouping change
    onGrouped(updated);
  };

  const ungroupSelected = () => {
    if (selectedItems.size === 0) {
      alert('Please select items to ungroup');
      return;
    }

    const updated = groupedItems.map(item =>
      selectedItems.has(item.id)
        ? { ...item, productGroup: item.id }
        : item
    );

    setGroupedItems(updated);
    setSelectedItems(new Set());
    
    // Notify parent immediately of grouping change
    onGrouped(updated);
  };

  const autoGroupSimilar = () => {
    // Simple auto-grouping by category (in production, use image similarity AI)
    const categoryGroups: Record<string, string[]> = {};
    
    groupedItems.forEach(item => {
      if (!item.category) return;
      if (!categoryGroups[item.category]) {
        categoryGroups[item.category] = [];
      }
      categoryGroups[item.category].push(item.id);
    });

    const updated = groupedItems.map(item => {
      if (!item.category) return item;
      const groupItems = categoryGroups[item.category];
      if (groupItems.length > 1) {
        const groupIndex = groupItems.indexOf(item.id);
        return { ...item, productGroup: `auto-${item.category}-${Math.floor(groupIndex / 3)}` };
      }
      return item;
    });

    setGroupedItems(updated);
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

  const groups = getGroups();
  const multiItemGroups = Object.entries(groups).filter(([_, items]) => items.length > 1);
  const singleItems = Object.entries(groups).filter(([_, items]) => items.length === 1).flatMap(([_, items]) => items);

  const handleContinue = () => {
    onGrouped(groupedItems);
  };

  return (
    <div className="image-grouper-container">
      <div className="grouper-header">
        <div className="stats">
          <span>📦 {multiItemGroups.length} Product Groups</span>
          <span>📄 {singleItems.length} Single Items</span>
          <span>🖼️ {groupedItems.length} Total Images</span>
        </div>
      </div>

      <div className="grouper-actions">
        <button 
          className="button button-secondary" 
          onClick={createGroup}
          disabled={selectedItems.size < 2}
        >
          🔗 Group Selected ({selectedItems.size})
        </button>
        <button 
          className="button" 
          onClick={ungroupSelected}
          disabled={selectedItems.size === 0}
        >
          ✂️ Ungroup Selected
        </button>
        <button 
          className="button" 
          onClick={autoGroupSimilar}
        >
          🤖 Auto-Group Similar
        </button>
        <button 
          className="button" 
          onClick={() => setSelectedItems(new Set())}
          disabled={selectedItems.size === 0}
        >
          ❌ Clear Selection
        </button>
      </div>

      <div className="grouper-instructions">
        <p>💡 <strong>Tip:</strong> Click images to select them, then click "Group Selected" to combine multiple images into one product listing.</p>
      </div>

      {/* Multi-image groups */}
      {multiItemGroups.length > 0 && (
        <div className="groups-section">
          <h3>📦 Product Groups ({multiItemGroups.length})</h3>
          <div className="groups-grid">
            {multiItemGroups.map(([groupId, items]) => (
              <div key={groupId} className="product-group-card">
                <div className="group-header">
                  <span className="group-badge">
                    {items.length} images
                  </span>
                  <span className="category-badge">{items[0].category || 'Uncategorized'}</span>
                </div>
                <div className="group-images">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`group-image-item ${selectedItems.has(item.id) ? 'selected' : ''}`}
                      onClick={() => toggleItemSelection(item.id)}
                    >
                      <img src={item.preview} alt="Product" />
                      {selectedItems.has(item.id) && (
                        <div className="selection-indicator">✓</div>
                      )}
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
            {singleItems.map((item) => (
              <div
                key={item.id}
                className={`single-item-card ${selectedItems.has(item.id) ? 'selected' : ''}`}
                onClick={() => toggleItemSelection(item.id)}
              >
                <img src={item.preview} alt="Product" />
                {selectedItems.has(item.id) && (
                  <div className="selection-indicator">✓</div>
                )}
                <div className="item-info">
                  <span className="category-badge">{item.category || 'Uncategorized'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grouper-footer">
        <button 
          className="button button-secondary" 
          onClick={handleContinue}
        >
          Continue to Categorize Products →
        </button>
        <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem', textAlign: 'center' }}>
          💡 Tip: You can return here to adjust grouping - changes will refresh the next steps
        </p>
      </div>
    </div>
  );
};

export default ImageGrouper;
