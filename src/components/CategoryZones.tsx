import { useState, useEffect } from 'react';
import type { ClothingItem } from '../App';
import { getCategories } from '../lib/categoriesService';
import type { Category } from '../lib/categories';
import { applyPresetToProductGroup } from '../lib/applyPresetToGroup';
import { 
  Shirt, 
  Wind, 
  User, 
  Package, 
  Box,
  ShoppingBag,
  Footprints,
  Glasses,
  Watch,
  Headphones,
  Briefcase,
  Heart,
  Star,
  Zap
} from 'lucide-react';
import './CategoryZones.css';

// Map icon names or category names to icon components
const getCategoryIcon = (iconNameOrCategory: string, size: number = 24) => {
  const name = iconNameOrCategory.toLowerCase();
  
  // Direct icon name mapping (from database)
  const iconMap: Record<string, React.ReactNode> = {
    'shirt': <Shirt size={size} />,
    'wind': <Wind size={size} />,
    'footprints': <Footprints size={size} />,
    'user': <User size={size} />,
    'glasses': <Glasses size={size} />,
    'box': <Box size={size} />,
    'package': <Package size={size} />,
    'shopping-bag': <ShoppingBag size={size} />,
    'watch': <Watch size={size} />,
    'headphones': <Headphones size={size} />,
    'briefcase': <Briefcase size={size} />,
    'heart': <Heart size={size} />,
    'star': <Star size={size} />,
    'zap': <Zap size={size} />,
  };
  
  // Check if it's a direct icon name first
  if (iconMap[name]) {
    return iconMap[name];
  }
  
  // Fallback to category name matching (for backward compatibility)
  if (name.includes('sweatshirt') || name.includes('hoodie')) {
    return <Shirt size={size} />;
  }
  if (name.includes('outerwear') || name.includes('jacket') || name.includes('coat')) {
    return <Wind size={size} />;
  }
  if (name.includes('tee') || name.includes('t-shirt') || name.includes('shirt')) {
    return <Shirt size={size} />;
  }
  if (name.includes('bottom') || name.includes('pant') || name.includes('jean') || name.includes('short')) {
    return <Footprints size={size} />;
  }
  if (name.includes('femme') || name.includes('feminine') || name.includes('dress') || name.includes('skirt')) {
    return <User size={size} />;
  }
  if (name.includes('hat') || name.includes('cap') || name.includes('beanie')) {
    return <Glasses size={size} />;
  }
  if (name.includes('mystery') || name.includes('box')) {
    return <Box size={size} />;
  }
  
  // Default icon
  return <Package size={size} />;
};

interface CategoryZonesProps {
  items: ClothingItem[];
  onCategorized: (items: ClothingItem[]) => void;
}

const CategoryZones: React.FC<CategoryZonesProps> = ({ items, onCategorized }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedItem, setDraggedItem] = useState<ClothingItem | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);

  // Load categories from database
  useEffect(() => {
    loadCategories();
    
    // Listen for category updates from CategoriesManager
    const handleCategoriesUpdated = () => {
      loadCategories();
    };
    
    window.addEventListener('categoriesUpdated', handleCategoriesUpdated);
    
    return () => {
      window.removeEventListener('categoriesUpdated', handleCategoriesUpdated);
    };
  }, []);

  const loadCategories = async () => {
    try {
      const data = await getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Failed to load categories:', error);
      // Fallback to default categories if database fails
      setCategories([
        { id: '1', user_id: '', name: 'sweatshirts', display_name: 'Sweatshirts', emoji: '🧥', color: '#667eea', sort_order: 1, is_active: true, created_at: '', updated_at: '' },
        { id: '2', user_id: '', name: 'outerwear', display_name: 'Outerwear', emoji: '🧥', color: '#764ba2', sort_order: 2, is_active: true, created_at: '', updated_at: '' },
        { id: '3', user_id: '', name: 'tees', display_name: 'Tees', emoji: '👕', color: '#f093fb', sort_order: 3, is_active: true, created_at: '', updated_at: '' },
        { id: '4', user_id: '', name: 'bottoms', display_name: 'Bottoms', emoji: '👖', color: '#4facfe', sort_order: 4, is_active: true, created_at: '', updated_at: '' },
        { id: '5', user_id: '', name: 'femme', display_name: 'Feminine', emoji: '👗', color: '#fa709a', sort_order: 5, is_active: true, created_at: '', updated_at: '' },
        { id: '6', user_id: '', name: 'hats', display_name: 'Hats', emoji: '🧢', color: '#30cfd0', sort_order: 6, is_active: true, created_at: '', updated_at: '' },
        { id: '7', user_id: '', name: 'mystery boxes', display_name: 'Mystery Boxes', emoji: '📦', color: '#a8edea', sort_order: 7, is_active: true, created_at: '', updated_at: '' },
      ]);
    } finally {
      setLoading(false);
    }
  };

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

  const handleCategoryDrop = async (e: React.DragEvent, category: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    let productGroup: string | undefined;
    
    // Try to get data from dataTransfer (for drags from Step 2)
    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const dragData = JSON.parse(data);
        productGroup = dragData.productGroup;
      }
    } catch (err) {
      console.error('❌ Failed to parse drag data:', err);
      // If parsing fails, fall back to draggedItem
    }
    
    // Fall back to local draggedItem state (for drags within Step 3)
    if (!productGroup && draggedItem) {
      productGroup = draggedItem.productGroup || draggedItem.id;
    }
    
    if (!productGroup) {
      console.error('❌ No product group found!');
      setDraggedItem(null);
      setDragOverCategory(null);
      return;
    }

    // Get all items in this product group
    const groupItems = items.filter(item => {
      const itemGroup = item.productGroup || item.id;
      return itemGroup === productGroup;
    });

    // Apply category preset to the group
    const itemsWithPreset = await applyPresetToProductGroup(groupItems, category);

    // Update all items in the same product group with the category and preset data
    const updated = items.map(item => {
      const itemGroup = item.productGroup || item.id;
      if (itemGroup === productGroup) {
        // Find the corresponding item with preset data
        const itemWithPreset = itemsWithPreset.find(i => i.id === item.id);
        return itemWithPreset || { ...item, category };
      }
      return item;
    });

    onCategorized(updated);
    
    // Always clear drag state after drop
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
        {loading ? (
          <p>Loading categories...</p>
        ) : (
          <div className="category-grid">
            {categories.map(category => (
              <div
                key={category.id}
                className={`category-zone ${dragOverCategory === category.name ? 'drag-over' : ''}`}
                style={{ 
                  borderColor: category.color,
                  '--category-color': category.color 
                } as React.CSSProperties}
                onDragOver={(e) => handleCategoryDragOver(e, category.name)}
                onDrop={(e) => handleCategoryDrop(e, category.name)}
                onDragLeave={handleCategoryDragLeave}
              >
                <span className="category-icon">{getCategoryIcon(category.emoji || category.name, 32)}</span>
                <span className="category-name">{category.display_name}</span>
                <span className="category-count">
                  ({items.filter(i => i.category === category.name).length})
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All Product Groups (including single items) */}
      {allProductGroups.length > 0 && (
        <div className="groups-section">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={20} /> All Product Groups ({allProductGroups.length})
          </h3>
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
