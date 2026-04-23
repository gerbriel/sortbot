import { useState, useEffect, useRef } from 'react';
import type { ClothingItem } from '../App';
import { getCategories } from '../lib/categoriesService';
import { getCategoryPresets } from '../lib/categoryPresetsService';
import type { Category } from '../lib/categories';
import type { CategoryPreset } from '../lib/categoryPresets';
import { applyPresetDirectly } from '../lib/applyPresetToGroup';
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
  X,
  Users,
  UserRound,
  Baby,
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
  if (name.includes('bag') || name.includes('purse') || name.includes('mystery') || name.includes('box')) {
    return <Box size={size} />;
  }
  if (name.includes('access') || name.includes('jewelry') || name.includes('watch')) {
    return <Package size={size} />;
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
  const [_categories, setCategories] = useState<Category[]>([]);
  const [presets, setPresets] = useState<CategoryPreset[]>([]);
  const [genderFilter, setGenderFilter] = useState<'Men' | 'Women' | 'Kids'>(() =>
    (localStorage.getItem('dropzone_gender_filter') as 'Men' | 'Women' | 'Kids') || 'Men'
  );
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

  const setZoneGender = (g: 'Men' | 'Women' | 'Kids') => {
    setGenderFilter(g);
    localStorage.setItem('dropzone_gender_filter', g);
  };

  // Load categories from database
  useEffect(() => {
    loadCategories();
    loadPresets();
    const handleCategoriesUpdated = () => loadCategories();
    window.addEventListener('categoriesUpdated', handleCategoriesUpdated);
    return () => window.removeEventListener('categoriesUpdated', handleCategoriesUpdated);
  }, []);

  const loadPresets = async () => {
    try {
      const all = await getCategoryPresets();
      setPresets(all.filter((p: any) => p.is_active !== false));
    } catch (e) {
      console.error('Failed to load presets for drop zones:', e);
    }
  };

  // Find the best matching preset from already-loaded `presets` state — no network fetch needed
  const findPreset = (categoryName: string): import('../lib/categoryPresets').CategoryPreset | undefined => {
    const lower = categoryName.toLowerCase();
    return (
      presets.find(p => (p.category_name ?? p.product_type ?? '').toLowerCase() === lower) ||
      presets.find(p => (p.category_name ?? p.product_type ?? '').toLowerCase().includes(lower)) ||
      presets.find(p => p.is_default)
    );
  };

  const applyPreset = (groupItems: ClothingItem[], categoryName: string): ClothingItem[] => {
    const preset = findPreset(categoryName);
    return preset
      ? applyPresetDirectly(groupItems, categoryName, preset)
      : groupItems.map(i => ({ ...i, category: categoryName }));
  };

  const zonePresets = (() => {
    // Sort order: shared categories first (appear across all 3), gender-unique ones at bottom
    const SORT_ORDER: Record<string, number> = {
      // Tops group (shared)
      'tees': 1, 'mens-tees': 1, 'womens-tees': 1, 'kids-tees': 1,
      'shirts': 2, 'mens-shirts': 2, 'kids-shirts': 2,
      'tops': 3, 'womens-tops': 3,
      // Fleece group (shared)
      'sweatshirts': 4, 'mens-sweatshirts': 4, 'womens-sweatshirts': 4, 'kids-sweatshirts': 4,
      'hoodies': 5, 'mens-hoodies': 5, 'womens-hoodies': 5, 'kids-hoodies': 5,
      // Outerwear (shared)
      'jackets': 6, 'mens-jackets': 6, 'womens-jackets': 6, 'kids-jackets': 6,
      // Bottoms (shared)
      'pants': 7, 'mens-pants': 7, 'womens-pants': 7, 'kids-pants': 7,
      'jeans': 8, 'mens-jeans': 8, 'womens-jeans': 8,
      'shorts': 9, 'mens-shorts': 9, 'womens-shorts': 9, 'kids-shorts': 9,
      // Gender-unique
      'mens-jerseys': 10,
      'womens-dresses': 11, 'kids-dresses': 11,
      'womens-skirts': 12,
      'womens-bodysuits': 13,
      // Accessories (shared — always near bottom)
      'hats': 14, 'mens-hats': 14, 'womens-hats': 14, 'kids-hats': 14,
      'shoes': 15, 'mens-shoes': 15, 'womens-shoes': 15, 'kids-shoes': 15,
      'accessories': 16, 'mens-accessories': 16, 'womens-accessories': 16, 'kids-accessories': 16,
    };
    const filtered = presets.filter(p => (p as any).gender === genderFilter);
    return [...filtered].sort((a, b) => {
      const ao = SORT_ORDER[a.category_name] ?? 99;
      const bo = SORT_ORDER[b.category_name] ?? 99;
      return ao !== bo ? ao - bo : a.display_name.localeCompare(b.display_name);
    });
  })();

  // Color per product type — consistent across Men/Women/Kids so the same
  // category type always appears in the same color regardless of gender toggle.
  const getPresetColor = (categoryName: string): string => {
    const n = categoryName.toLowerCase();
    if (n.includes('tee') || n.includes('shirt') || n.includes('top') || n.includes('jersey') || n.includes('bodysuit')) return '#3b82f6'; // blue — tops
    if (n.includes('sweatshirt') || n.includes('hoodie')) return '#8b5cf6'; // purple — fleece
    if (n.includes('jacket') || n.includes('coat') || n.includes('outerwear')) return '#06b6d4'; // cyan — outerwear
    if (n.includes('pant') || n.includes('jean') || n.includes('short') || n.includes('bottom')) return '#10b981'; // green — bottoms
    if (n.includes('dress') || n.includes('skirt')) return '#ec4899'; // pink — dresses/skirts
    if (n.includes('hat') || n.includes('cap')) return '#f59e0b'; // amber — hats
    if (n.includes('shoe') || n.includes('sneaker') || n.includes('boot')) return '#f97316'; // orange — shoes
    if (n.includes('access') || n.includes('bag') || n.includes('watch') || n.includes('jewel')) return '#6b7280'; // gray — accessories
    return '#6366f1'; // indigo default
  };

  const loadCategories = async () => {
    try {
      const data = await getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Failed to load categories:', error);
      setCategories([
        { id: '1', user_id: '', name: 'sweatshirts', display_name: 'Sweatshirts', emoji: '🧥', color: '#667eea', sort_order: 1, is_active: true, created_at: '', updated_at: '' },
        { id: '2', user_id: '', name: 'outerwear',   display_name: 'Outerwear',   emoji: '🧥', color: '#764ba2', sort_order: 2, is_active: true, created_at: '', updated_at: '' },
        { id: '3', user_id: '', name: 'tees',        display_name: 'Tees',        emoji: '👕', color: '#f093fb', sort_order: 3, is_active: true, created_at: '', updated_at: '' },
        { id: '4', user_id: '', name: 'bottoms',     display_name: 'Bottoms',     emoji: '👖', color: '#4facfe', sort_order: 4, is_active: true, created_at: '', updated_at: '' },
        { id: '5', user_id: '', name: 'hats',        display_name: 'Hats',        emoji: '🧢', color: '#30cfd0', sort_order: 5, is_active: true, created_at: '', updated_at: '' },
        { id: '6', user_id: '', name: 'bags',        display_name: 'Bags',        emoji: '👜', color: '#a8edea', sort_order: 6, is_active: true, created_at: '', updated_at: '' },
        { id: '7', user_id: '', name: 'accessories', display_name: 'Accessories', emoji: '�️', color: '#fccb90', sort_order: 7, is_active: true, created_at: '', updated_at: '' },
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

  // Sync groupOrder when new groups appear or when grouping changes
  // (items.length alone is not enough — creating a group merges items without changing count)
  const groupIdsKey = Object.keys(groupsMap).sort().join(',');
  useEffect(() => {
    const currentIds = Object.keys(groupsMap);
    setGroupOrder(prev => {
      const existing = prev.filter(id => currentIds.includes(id));
      const newIds = currentIds.filter(id => !prev.includes(id));
      return [...existing, ...newIds];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsKey]);

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
    const itemsWithPreset = applyPreset(groupItems, category);
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

    // Collect all unique group IDs touched by the selection.
    // A group is "already grouped" if it has 2+ members in the full items list.
    // Singles are items whose group has only 1 member (i.e. ungrouped).
    const selectedGroupIds = [...new Set(selected.map(i => i.productGroup || i.id))];

    const trueMultiGroups: string[] = [];
    const trueSingles: ClothingItem[] = [];

    selectedGroupIds.forEach(gid => {
      const fullGroup = items.filter(i => (i.productGroup || i.id) === gid);
      if (fullGroup.length > 1) {
        trueMultiGroups.push(gid);
      } else {
        // Group of 1 — treat as a single to be merged
        trueSingles.push(...selected.filter(i => (i.productGroup || i.id) === gid));
      }
    });

    const mergedSinglesGroupId = trueSingles.length > 0 ? (trueSingles[0].productGroup || trueSingles[0].id) : null;
    const selectedSet = new Set(selected.map(i => i.id));

    // Apply preset to singles as one merged group
    const singlesWithPreset = trueSingles.length > 0
      ? applyPreset(trueSingles, categoryName)
      : [];
    const singlesWithPresetById: Record<string, ClothingItem> = {};
    singlesWithPreset.forEach(i => { singlesWithPresetById[i.id] = i; });

    // Apply preset independently to each true multi-image group (all members, not just selected)
    const groupedWithPresetById: Record<string, ClothingItem> = {};
    for (const gid of trueMultiGroups) {
      const fullGroup = items.filter(i => (i.productGroup || i.id) === gid);
      const withPreset = applyPreset(fullGroup, categoryName);
      withPreset.forEach(i => { groupedWithPresetById[i.id] = i; });
    }

    // Rebuild groupsMap
    const updatedMap = { ...groupsMap };

    // 1. Merge singles into one group
    if (mergedSinglesGroupId) {
      const singlesInOrder = (groupsMap[mergedSinglesGroupId] || []).filter(i => !selectedSet.has(i.id));
      updatedMap[mergedSinglesGroupId] = [
        ...trueSingles.map(item => ({
          ...(singlesWithPresetById[item.id] || { ...item, category: categoryName }),
          productGroup: mergedSinglesGroupId,
        })),
        ...singlesInOrder.map(i => ({ ...i, productGroup: mergedSinglesGroupId })),
      ];
      // Remove other single-group entries that were merged away
      trueSingles.forEach(i => {
        const gid = i.productGroup || i.id;
        if (gid !== mergedSinglesGroupId) delete updatedMap[gid];
      });
    }

    // 2. Replace multi-group entries wholesale with preset-applied versions
    for (const gid of trueMultiGroups) {
      const originalOrder = groupsMap[gid] || [];
      updatedMap[gid] = originalOrder.map(i => groupedWithPresetById[i.id] ?? i);
    }

    // Rebuild group order
    const removedGroupIds = new Set<string>();
    trueSingles.forEach(i => {
      const gid = i.productGroup || i.id;
      if (gid !== mergedSinglesGroupId) removedGroupIds.add(gid);
    });
    const newGroupOrder = groupOrderRef.current.filter(gid => !removedGroupIds.has(gid));
    if (mergedSinglesGroupId && !newGroupOrder.includes(mergedSinglesGroupId)) {
      newGroupOrder.push(mergedSinglesGroupId);
    }

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
        {/* Gender filter toggles */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', justifyContent: 'center' }}>
          {([
            { key: 'Men',   label: 'Men',   Icon: Users },
            { key: 'Women', label: 'Women', Icon: UserRound },
            { key: 'Kids',  label: 'Kids',  Icon: Baby },
          ] as const).map(({ key: g, label, Icon }) => (
            <button
              key={g}
              onClick={() => setZoneGender(g)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.3rem 1rem',
                borderRadius: '999px',
                border: '2px solid',
                borderColor: genderFilter === g ? '#6366f1' : '#d1d5db',
                background: genderFilter === g ? '#6366f1' : '#fff',
                color: genderFilter === g ? '#fff' : '#374151',
                fontWeight: 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

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
            {(zonePresets.length > 0 ? zonePresets : []).map(preset => {
              const color = getPresetColor(preset.category_name);
              return (
              <div
                key={preset.id}
                className={`category-zone ${dragOverCategory === preset.category_name ? 'drag-over' : ''}${selectedItemIds && selectedItemIds.size > 0 ? ' clickable' : ''}`}
                style={{ borderColor: color, '--category-color': color, cursor: selectedItemIds && selectedItemIds.size > 0 ? 'pointer' : undefined } as React.CSSProperties}
                onDragOver={(e) => handleCategoryDragOver(e, preset.category_name)}
                onDrop={(e) => handleCategoryDrop(e, preset.category_name)}
                onDragLeave={handleCategoryDragLeave}
                onClick={() => handleCategoryClick(preset.category_name)}
              >
                <span className="category-icon">{getCategoryIcon(preset.category_name, compactMode ? 20 : 32)}</span>
                <span className="category-name">{preset.display_name}</span>
                <span className="category-count">
                  ({items.filter(i => i.category === preset.category_name).length})
                </span>
              </div>
              );
            })}
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
