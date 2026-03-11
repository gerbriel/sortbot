import { useState, useEffect, useRef } from 'react';
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
  Zap,
  GripVertical
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
  compactMode?: boolean;
  pendingGroupId?: string | null;
  selectedImageIds?: Set<string>;
  onCategoryClick?: (category: string) => void;
}

const CategoryZones: React.FC<CategoryZonesProps> = ({ items, onCategorized, compactMode = false, pendingGroupId, selectedImageIds, onCategoryClick }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Category-drop drag state ────────────────────────────────────────────
  const [catDraggedItem, setCatDraggedItem] = useState<ClothingItem | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);

  // ── Group reorder drag state ────────────────────────────────────────────
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // ── Photo reorder drag state ────────────────────────────────────────────
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  const [draggedPhotoGroup, setDraggedPhotoGroup] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);

  // Stable ordered list of group IDs (controls export order)
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const groupOrderRef = useRef(groupOrder);
  groupOrderRef.current = groupOrder;

  // Load categories from database
  useEffect(() => {
    loadCategories();
    const handleCategoriesUpdated = () => loadCategories();
    window.addEventListener('categoriesUpdated', handleCategoriesUpdated);
    return () => window.removeEventListener('categoriesUpdated', handleCategoriesUpdated);
  }, []);

  const loadCategories = async () => {
    try {
      const data = await getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Failed to load categories:', error);
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

  // ── Derive ordered groups from items + groupOrder ───────────────────────
  const groupsMap = (() => {
    const map: Record<string, ClothingItem[]> = {};
    items.forEach(item => {
      const gid = item.productGroup || item.id;
      if (!map[gid]) map[gid] = [];
      map[gid].push(item);
    });
    return map;
  })();

  // Sync groupOrder when new groups appear (new items added)
  useEffect(() => {
    const currentIds = Object.keys(groupsMap);
    setGroupOrder(prev => {
      const existing = prev.filter(id => currentIds.includes(id));
      const newIds = currentIds.filter(id => !prev.includes(id));
      return [...existing, ...newIds];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const orderedGroups: [string, ClothingItem[]][] = groupOrder
    .filter(id => groupsMap[id])
    .map(id => [id, groupsMap[id]]);

  // ── Helper: emit updated items preserving group+photo order ────────────
  const emitReordered = (newGroupOrder: string[], newGroupsMap: Record<string, ClothingItem[]>) => {
    const reordered: ClothingItem[] = [];
    newGroupOrder.forEach(gid => {
      if (newGroupsMap[gid]) reordered.push(...newGroupsMap[gid]);
    });
    onCategorized(reordered);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Category-drop handlers (drag group card → drop on category zone)
  // ══════════════════════════════════════════════════════════════════════════

  const handleCatDragStart = (e: React.DragEvent, item: ClothingItem) => {
    setCatDraggedItem(item);
    e.dataTransfer.setData('application/json', JSON.stringify({
      item,
      productGroup: item.productGroup || item.id,
      action: 'categorize',
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleCatDragEnd = () => {
    setCatDraggedItem(null);
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
    let draggedGroupItems: ClothingItem[] | undefined;
    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const dragData = JSON.parse(data);
        // Accept: explicit 'categorize' action OR any drag from ImageGrouper
        if (dragData.action === 'categorize' || dragData.source === 'ImageGrouper') {
          productGroup = dragData.productGroup;
          // Use the items carried in the drag payload (avoids stale-prop mismatch)
          if (Array.isArray(dragData.groupItems) && dragData.groupItems.length > 0) {
            draggedGroupItems = dragData.groupItems;
          } else if (dragData.item) {
            draggedGroupItems = [dragData.item];
          }
        }
      }
    } catch (err) {
      console.error('Failed to parse drag data:', err);
    }
    if (!productGroup && catDraggedItem) {
      productGroup = catDraggedItem.productGroup || catDraggedItem.id;
    }
    if (!productGroup) { setCatDraggedItem(null); setDragOverCategory(null); return; }

    // Prefer items carried in drag data; fall back to filtering the items prop
    const groupItems = (draggedGroupItems && draggedGroupItems.length > 0)
      ? draggedGroupItems
      : items.filter(item => (item.productGroup || item.id) === productGroup);

    // Guard: nothing to categorize
    if (groupItems.length === 0) {
      console.warn('⚠️ handleCategoryDrop: no items found for group', productGroup);
      setCatDraggedItem(null);
      setDragOverCategory(null);
      return;
    }

    const itemsWithPreset = await applyPresetToProductGroup(groupItems, category);

    const updatedMap = { ...groupsMap };
    // groupsMap[productGroup] may be undefined if the group lives only in
    // ImageGrouper's internal state and hasn't synced to groupedImages yet.
    // Fall back to itemsWithPreset directly in that case.
    const baseItems = groupsMap[productGroup] ?? groupItems;
    updatedMap[productGroup] = baseItems.map(item => {
      const withPreset = itemsWithPreset.find(i => i.id === item.id);
      return withPreset || { ...item, category };
    });

    // If this group wasn't in groupOrder yet, append it
    const currentOrder = groupOrderRef.current;
    const newOrder = currentOrder.includes(productGroup)
      ? currentOrder
      : [...currentOrder, productGroup];

    emitReordered(newOrder, updatedMap);
    setCatDraggedItem(null);
    setDragOverCategory(null);
  };

  const handleCategoryDragLeave = () => setDragOverCategory(null);

  // ══════════════════════════════════════════════════════════════════════════
  // Group reorder handlers (drag the ⠿ handle on a group card)
  // ══════════════════════════════════════════════════════════════════════════

  const handleGroupDragStart = (e: React.DragEvent, groupId: string) => {
    e.stopPropagation();
    setDraggedGroupId(groupId);
    e.dataTransfer.setData('application/json', JSON.stringify({ action: 'reorder-group', groupId }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleGroupDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedGroupId && draggedGroupId !== groupId) {
      setDragOverGroupId(groupId);
    }
  };

  const handleGroupDrop = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    e.stopPropagation();

    let sourceGroupId: string | null = null;
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.action === 'reorder-group') sourceGroupId = data.groupId;
    } catch { /* ignore */ }

    sourceGroupId = sourceGroupId || draggedGroupId;

    if (!sourceGroupId || sourceGroupId === targetGroupId) {
      setDraggedGroupId(null);
      setDragOverGroupId(null);
      return;
    }

    const newOrder = [...groupOrderRef.current];
    const fromIdx = newOrder.indexOf(sourceGroupId);
    const toIdx = newOrder.indexOf(targetGroupId);
    if (fromIdx === -1 || toIdx === -1) return;

    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, sourceGroupId);

    setGroupOrder(newOrder);
    emitReordered(newOrder, groupsMap);
    setDraggedGroupId(null);
    setDragOverGroupId(null);
  };

  const handleGroupDragEnd = () => {
    setDraggedGroupId(null);
    setDragOverGroupId(null);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Photo reorder handlers (drag photos within a group)
  // ══════════════════════════════════════════════════════════════════════════

  const handlePhotoDragStart = (e: React.DragEvent, photoId: string, groupId: string) => {
    e.stopPropagation();
    setDraggedPhotoId(photoId);
    setDraggedPhotoGroup(groupId);
    e.dataTransfer.setData('application/json', JSON.stringify({ action: 'reorder-photo', photoId, groupId }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePhotoDragOver = (e: React.DragEvent, photoId: string, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedPhotoGroup === groupId && draggedPhotoId !== photoId) {
      setDragOverPhotoId(photoId);
    }
  };

  const handlePhotoDrop = (e: React.DragEvent, targetPhotoId: string, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();

    let srcPhotoId: string | null = null;
    let srcGroupId: string | null = null;
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.action === 'reorder-photo') { srcPhotoId = data.photoId; srcGroupId = data.groupId; }
    } catch { /* ignore */ }

    srcPhotoId = srcPhotoId || draggedPhotoId;
    srcGroupId = srcGroupId || draggedPhotoGroup;

    if (!srcPhotoId || !srcGroupId || srcGroupId !== groupId || srcPhotoId === targetPhotoId) {
      setDraggedPhotoId(null); setDraggedPhotoGroup(null); setDragOverPhotoId(null);
      return;
    }

    const photoList = [...(groupsMap[groupId] || [])];
    const fromIdx = photoList.findIndex(p => p.id === srcPhotoId);
    const toIdx = photoList.findIndex(p => p.id === targetPhotoId);
    if (fromIdx === -1 || toIdx === -1) return;

    photoList.splice(fromIdx, 1);
    photoList.splice(toIdx, 0, groupsMap[groupId][fromIdx]);

    const newMap = { ...groupsMap, [groupId]: photoList };
    emitReordered(groupOrderRef.current, newMap);
    setDraggedPhotoId(null); setDraggedPhotoGroup(null); setDragOverPhotoId(null);
  };

  const handlePhotoDragEnd = () => {
    setDraggedPhotoId(null);
    setDraggedPhotoGroup(null);
    setDragOverPhotoId(null);
  };

  return (
    <div className={`category-zones-container${compactMode ? ' compact-mode' : ''}`}>
      {/* Category Zones */}
      <div className={`category-zones${compactMode ? ' category-zones-compact' : ''}`}>
        <h3>
          {compactMode
            ? (selectedImageIds && selectedImageIds.size > 0
                ? `✅ ${selectedImageIds.size} selected — click a category below`
                : pendingGroupId
                  ? '👆 Now click a category below'
                  : '🏷️ Select images or drag a group, then click a category')
            : '🏷️ Drag Groups Here to Categorize'}
        </h3>
        {loading ? (
          <p>Loading categories...</p>
        ) : (
          <div className={compactMode ? 'category-list' : 'category-grid'}>
            {categories.map(category => (
              <div
                key={category.id}
                className={`category-zone${compactMode ? ' category-zone-compact' : ''} ${dragOverCategory === category.name ? 'drag-over' : ''} ${(pendingGroupId || (selectedImageIds && selectedImageIds.size > 0)) ? 'category-zone-clickable' : ''}`}
                style={{ borderColor: category.color, '--category-color': category.color } as React.CSSProperties}
                onDragOver={(e) => handleCategoryDragOver(e, category.name)}
                onDrop={(e) => handleCategoryDrop(e, category.name)}
                onDragLeave={handleCategoryDragLeave}
                onClick={() => {
                  if ((selectedImageIds && selectedImageIds.size > 0) || pendingGroupId) {
                    onCategoryClick?.(category.name);
                  }
                }}
              >
                <span className="category-icon">{getCategoryIcon(category.emoji || category.name, compactMode ? 20 : 32)}</span>
                <span className="category-name">{category.display_name}</span>
                <span className="category-count">
                  ({items.filter(i => i.category === category.name).length})
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All Product Groups — hidden in compact mode (shown in ImageGrouper instead) */}
      {!compactMode && orderedGroups.length > 0 && (
        <div className="groups-section">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={20} /> All Product Groups ({orderedGroups.length})
          </h3>
          <p className="reorder-hint">
            ☰ Drag the <strong>grip handle</strong> on a card to reorder groups · Drag <strong>photos within a card</strong> to reorder images
          </p>
          <div className="groups-grid">
            {orderedGroups.map(([groupId, groupItems], idx) => (
              <div
                key={groupId}
                className={`product-group-card ${groupItems[0].category ? 'has-category' : ''} ${dragOverGroupId === groupId ? 'group-drag-over' : ''} ${draggedGroupId === groupId ? 'group-dragging' : ''}`}
                onDragOver={(e) => handleGroupDragOver(e, groupId)}
                onDrop={(e) => handleGroupDrop(e, groupId)}
                onDragLeave={() => setDragOverGroupId(null)}
              >
                {/* Position badge */}
                <div className="group-position-badge">#{idx + 1}</div>

                {/* Drag handle for group reordering */}
                <div
                  className="group-drag-handle"
                  draggable
                  onDragStart={(e) => handleGroupDragStart(e, groupId)}
                  onDragEnd={handleGroupDragEnd}
                  title="Drag to reorder group"
                >
                  <GripVertical size={18} />
                </div>

                {groupItems[0].category && (
                  <div className="category-indicator">
                    <span className="category-check">✓</span>
                    <span className="category-label">{groupItems[0].category}</span>
                  </div>
                )}
                <div
                  className="group-header"
                  draggable
                  onDragStart={(e) => handleCatDragStart(e, groupItems[0])}
                  onDragEnd={handleCatDragEnd}
                  title="Drag to a category zone above"
                  style={{ cursor: 'grab' }}
                >
                  <span className="group-badge">
                    {groupItems.length} {groupItems.length === 1 ? 'image' : 'images'}
                  </span>
                  {groupItems[0].category && (
                    <span className="category-badge">{groupItems[0].category}</span>
                  )}
                </div>

                {/* Photos grid — individual photos are draggable for reordering within group */}
                <div className="group-images">
                  {groupItems.map((item) => (
                    <div
                      key={item.id}
                      className={`group-image-item photo-draggable ${dragOverPhotoId === item.id && draggedPhotoGroup === groupId ? 'photo-drag-over' : ''} ${draggedPhotoId === item.id ? 'photo-dragging' : ''}`}
                      draggable
                      onDragStart={(e) => handlePhotoDragStart(e, item.id, groupId)}
                      onDragOver={(e) => handlePhotoDragOver(e, item.id, groupId)}
                      onDrop={(e) => handlePhotoDrop(e, item.id, groupId)}
                      onDragEnd={handlePhotoDragEnd}
                      onDragLeave={() => setDragOverPhotoId(null)}
                      title="Drag to reorder photo within group"
                    >
                      <img src={item.preview} alt="Product" draggable={false} />
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
