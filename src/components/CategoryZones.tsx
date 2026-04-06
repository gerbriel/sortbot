import { useState, useEffect, useRef } from 'react';
import type { ClothingItem } from '../App';
import { getCategories } from '../lib/categoriesService';
import type { Category } from '../lib/categories';
import { applyPresetToProductGroup } from '../lib/applyPresetToGroup';
import LazyImg from './LazyImg';
import { log } from '../lib/debugLogger';
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
  GripVertical,
  X
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
  /** When true, renders a compact vertical list (used inside the combined Step 2+3 panel) */
  compactMode?: boolean;
  /** IDs of items currently selected in ImageGrouper — clicking a category assigns them */
  selectedItemIds?: Set<string>;
  /** Called after a category is successfully assigned — parent should clear selection */
  onCategoryAssigned?: () => void;
}

const CategoryZones: React.FC<CategoryZonesProps> = ({ items, onCategorized, compactMode = false, selectedItemIds, onCategoryAssigned }) => {
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

    // If items are selected in ImageGrouper, treat the drop as a "click-to-assign":
    // merge all selected items into one product group and apply the category.
    if (selectedItemIds && selectedItemIds.size > 0) {
      log.sorter(`handleCategoryDrop | selected-assign | category=${category} selectedCount=${selectedItemIds.size}`);
      setCatDraggedItem(null);
      setDragOverCategory(null);
      await handleCategoryClick(category);
      return;
    }

    // No selection — fall back to single-group drop behaviour
    let productGroup: string | undefined;
    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const dragData = JSON.parse(data);
        if (dragData.action === 'categorize') {
          productGroup = dragData.productGroup;
        } else if (dragData.source === 'ImageGrouper') {
          productGroup = dragData.productGroup || dragData.item?.productGroup || dragData.item?.id;
        }
      }
    } catch (err) {
      console.error('Failed to parse drag data:', err);
    }
    if (!productGroup && catDraggedItem) {
      productGroup = catDraggedItem.productGroup || catDraggedItem.id;
    }
    if (!productGroup) { setCatDraggedItem(null); setDragOverCategory(null); return; }

    const groupItems = items.filter(item => (item.productGroup || item.id) === productGroup);
    const itemsWithPreset = await applyPresetToProductGroup(groupItems, category);
    log.sorter(`handleCategoryDrop | drag-assign | category=${category} productGroup=${productGroup} groupItems=${groupItems.length}`);

    const updatedMap = { ...groupsMap };
    updatedMap[productGroup] = (groupsMap[productGroup] || groupItems).map(item => {
      const withPreset = itemsWithPreset.find(i => i.id === item.id);
      return withPreset || { ...item, category };
    });

    emitReordered(groupOrderRef.current, updatedMap);
    setCatDraggedItem(null);
    setDragOverCategory(null);
    onCategoryAssigned?.();
  };

  const handleCategoryDragLeave = () => setDragOverCategory(null);

  // ══════════════════════════════════════════════════════════════════════════
  // Clear-category handler (removes category from selected or dragged group)
  // ══════════════════════════════════════════════════════════════════════════

  const [dragOverClear, setDragOverClear] = useState(false);

  const handleClearCategory = async (e?: React.DragEvent) => {
    // If called from a drop, try to get the group from drag data first
    let productGroup: string | undefined;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (data.action === 'categorize') productGroup = data.productGroup;
        else if (data.source === 'ImageGrouper') productGroup = data.productGroup || data.item?.productGroup || data.item?.id;
      } catch { /* ignore */ }
      if (!productGroup && catDraggedItem) productGroup = catDraggedItem.productGroup || catDraggedItem.id;
    }

    // If items are selected (click path or drop with selection), clear all selected
    if (selectedItemIds && selectedItemIds.size > 0) {
      log.sorter(`handleClearCategory | selected | count=${selectedItemIds.size}`);
      const updatedMap = { ...groupsMap };
      Object.keys(updatedMap).forEach(gid => {
        updatedMap[gid] = updatedMap[gid].map(item =>
          selectedItemIds.has(item.id) ? { ...item, category: undefined } : item
        );
      });
      emitReordered(groupOrderRef.current, updatedMap);
      onCategoryAssigned?.();
      setCatDraggedItem(null);
      setDragOverClear(false);
      return;
    }

    // Drop path without selection — clear the dragged group
    if (productGroup) {
      log.sorter(`handleClearCategory | drag | productGroup=${productGroup}`);
      const updatedMap = { ...groupsMap };
      if (updatedMap[productGroup]) {
        updatedMap[productGroup] = updatedMap[productGroup].map(item => ({ ...item, category: undefined }));
      }
      emitReordered(groupOrderRef.current, updatedMap);
      onCategoryAssigned?.();
    }
    setCatDraggedItem(null);
    setDragOverClear(false);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Category-click handler (click category zone with items selected in Step 2)
  // ══════════════════════════════════════════════════════════════════════════

  const handleCategoryClick = async (categoryName: string) => {
    if (!selectedItemIds || selectedItemIds.size === 0) return;

    const selected = items.filter(i => selectedItemIds.has(i.id));
    if (selected.length === 0) return;
    log.sorter(`handleCategoryClick | category=${categoryName} selectedCount=${selected.length}`);

    // If all selected items already share one group, reuse that group ID.
    // Otherwise, merge them all into the first selected item's group ID.
    const existingGroups = new Set(selected.map(i => i.productGroup || i.id));
    const mergedGroupId = selected[0].productGroup || selected[0].id;

    // Apply category preset to the merged set
    const itemsWithPreset = await applyPresetToProductGroup(selected, categoryName);

    // Rebuild the full items map:
    //  - selected items → assign mergedGroupId + category/preset
    //  - items that were in a now-absorbed group but NOT selected → keep them, but
    //    re-point their productGroup to mergedGroupId so the group isn't orphaned
    const selectedSet = new Set(selected.map(i => i.id));
    const updatedMap = { ...groupsMap };

    // Remove old entries for every group that's being merged away
    existingGroups.forEach(gid => {
      if (gid !== mergedGroupId) delete updatedMap[gid];
    });

    // Rebuild mergedGroupId bucket: selected items (with preset) + any non-selected
    // items that were already in mergedGroupId
    const nonSelectedInMergedGroup = (groupsMap[mergedGroupId] || []).filter(
      i => !selectedSet.has(i.id)
    );
    const mergedItems: ClothingItem[] = [
      ...selected.map(item => {
        const withPreset = itemsWithPreset.find(i => i.id === item.id);
        return { ...(withPreset || { ...item, category: categoryName }), productGroup: mergedGroupId };
      }),
      ...nonSelectedInMergedGroup.map(i => ({ ...i, productGroup: mergedGroupId })),
    ];
    updatedMap[mergedGroupId] = mergedItems;

    // Rebuild group order: remove absorbed group IDs, keep everything else
    const newGroupOrder = groupOrderRef.current.filter(gid => !existingGroups.has(gid) || gid === mergedGroupId);
    if (!newGroupOrder.includes(mergedGroupId)) newGroupOrder.push(mergedGroupId);

    emitReordered(newGroupOrder, updatedMap);
    onCategoryAssigned?.();
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Group reorder handlers (drag the grip handle on a group card)
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

    log.sorter(`handleGroupDrop | reorder | from=${fromIdx} to=${toIdx} groupId=${sourceGroupId}`);
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

    log.sorter(`handlePhotoDrop | reorder | groupId=${groupId} from=${fromIdx} to=${toIdx}`);
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
    <div className={`category-zones-container${compactMode ? ' compact' : ''}`}>
      {/* Category Zones */}
      <div className="category-zones">
        <h3>{compactMode ? '🏷️ Drop Here to Categorize' : '🏷️ Drag Groups Here to Categorize'}</h3>
        {compactMode && selectedItemIds && selectedItemIds.size > 0 && (
          <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0 0 0.5rem', textAlign: 'center' }}>
            {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''} selected — click a category to assign
          </p>
        )}
        {loading ? (
          <p>Loading categories...</p>
        ) : (
          <div className={compactMode ? 'category-list' : 'category-grid'}>
            {categories.map(category => (
              <div
                key={category.id}
                className={`category-zone ${dragOverCategory === category.name ? 'drag-over' : ''}${selectedItemIds && selectedItemIds.size > 0 ? ' clickable' : ''}`}
                style={{ borderColor: category.color, '--category-color': category.color, cursor: selectedItemIds && selectedItemIds.size > 0 ? 'pointer' : undefined } as React.CSSProperties}
                onDragOver={(e) => handleCategoryDragOver(e, category.name)}
                onDrop={(e) => handleCategoryDrop(e, category.name)}
                onDragLeave={handleCategoryDragLeave}
                onClick={() => handleCategoryClick(category.name)}
              >
                <span className="category-icon">{getCategoryIcon(category.emoji || category.name, compactMode ? 20 : 32)}</span>
                <span className="category-name">{category.display_name}</span>
                <span className="category-count">
                  ({items.filter(i => i.category === category.name).length})
                </span>
              </div>
            ))}
            {/* Clear Category zone */}
            <div
              className={`category-zone category-zone-clear ${dragOverClear ? 'drag-over-clear' : ''}${selectedItemIds && selectedItemIds.size > 0 ? ' clickable' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverClear(true); }}
              onDragLeave={() => setDragOverClear(false)}
              onDrop={(e) => handleClearCategory(e)}
              onClick={() => handleClearCategory()}
            >
              <span className="category-icon"><X size={compactMode ? 20 : 32} /></span>
              <span className="category-name">Clear Category</span>
              <span className="category-count">
                ({items.filter(i => i.category).length})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* All Product Groups — hidden in compactMode (they live in ImageGrouper on the left) */}
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
                      <LazyImg src={item.preview || item.imageUrls?.[0] || ''} alt="Product" draggable={false} />
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
