import { useState, useEffect, useRef } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import { Package, Image, Link2, Scissors, X, ArrowDown, Check, Trash2 } from 'lucide-react';
import LoadingProgress from './LoadingProgress';
import './ImageGrouper.css';

export interface ImageGrouperStats {
  multiImageGroups: number;
  singles: number;
  totalListings: number;
  totalImages: number;
}

interface ImageGrouperProps {
  items: ClothingItem[];
  onGrouped: (items: ClothingItem[]) => void;
  onStatsChange?: (stats: ImageGrouperStats) => void;
  userId?: string;
  onImageDeleted?: () => void; // called after any delete syncs to DB, so Library can refresh
  onSelectionChange?: (selectedIds: Set<string>) => void; // lift selection state so parent can pass to CategoryZones
}

const ImageGrouper: React.FC<ImageGrouperProps> = ({ items, onGrouped, onStatsChange, userId, onImageDeleted, onSelectionChange }) => {
  const [groupedItems, setGroupedItems] = useState<ClothingItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<ClothingItem | null>(null);
  const [draggedFromGroup, setDraggedFromGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // Photo reorder drag state (within a group)
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  const [draggedPhotoGroupId, setDraggedPhotoGroupId] = useState<string | null>(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<Set<string>>(new Set());
  
  // Loading progress state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Lightbox state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Selection box state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [activeContainer, setActiveContainer] = useState<'singles' | 'groups' | null>(null);
  const [selectionThresholdMet, setSelectionThresholdMet] = useState(false);
  
  // Refs for selection containers
  const singlesContainerRef = useRef<HTMLDivElement>(null);
  const groupsContainerRef = useRef<HTMLDivElement>(null);
  const currentContainerRef = useRef<HTMLElement | null>(null);
  
  const SELECTION_THRESHOLD = 5; // pixels - must move this much to activate selection

  // Global mouse handlers for selection
  useEffect(() => {
    if (!isSelecting) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!selectionStart || !currentContainerRef.current) return;
      
      const containerRef = currentContainerRef.current;
      const rect = containerRef.getBoundingClientRect();
      const currentX = e.clientX - rect.left + containerRef.scrollLeft;
      const currentY = e.clientY - rect.top + containerRef.scrollTop;
      
      // Calculate distance moved
      const distanceMoved = Math.sqrt(
        Math.pow(currentX - selectionStart.x, 2) + 
        Math.pow(currentY - selectionStart.y, 2)
      );
      
      // Only show selection box if moved beyond threshold
      if (distanceMoved < SELECTION_THRESHOLD) {
        return; // Don't create selection box yet
      }
      
      // Threshold met - activate selection
      if (!selectionThresholdMet) {
        setSelectionThresholdMet(true);
      }
      
      // Calculate selection box - ensure positive dimensions
      const x = Math.min(selectionStart.x, currentX);
      const y = Math.min(selectionStart.y, currentY);
      const width = Math.abs(currentX - selectionStart.x);
      const height = Math.abs(currentY - selectionStart.y);
      
      setSelectionBox({ x, y, width, height });
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      // Only perform selection if threshold was met
      if (!selectionBox || !currentContainerRef.current || !selectionThresholdMet) {
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionBox(null);
        setActiveContainer(null);
        setSelectionThresholdMet(false);
        currentContainerRef.current = null;
        return;
      }

      const containerRef = currentContainerRef.current;
      
      // Get all item elements and check which ones intersect with selection box
      const itemElements = containerRef.querySelectorAll('.single-item-card, .product-group-card');
      const newSelected = new Set(e.shiftKey ? selectedItems : new Set<string>());
      
      itemElements.forEach((element) => {
        const itemRect = element.getBoundingClientRect();
        const containerRect = containerRef.getBoundingClientRect();
        
        const itemX = itemRect.left - containerRect.left + containerRef.scrollLeft;
        const itemY = itemRect.top - containerRect.top + containerRef.scrollTop;
        const itemWidth = itemRect.width;
        const itemHeight = itemRect.height;
        
        // Check if selection box intersects with item
        const intersects = !(
          selectionBox.x + selectionBox.width < itemX ||
          selectionBox.x > itemX + itemWidth ||
          selectionBox.y + selectionBox.height < itemY ||
          selectionBox.y > itemY + itemHeight
        );
        
        if (intersects) {
          // Check if it's a single item or a group
          const itemId = element.getAttribute('data-item-id');
          const groupId = element.getAttribute('data-group-id');
          
          if (itemId) {
            // Single item - add just this item
            newSelected.add(itemId);
          } else if (groupId) {
            // Product group - add all items in this group
            const groupItems = groupedItems.filter(item => item.productGroup === groupId);
            groupItems.forEach(item => newSelected.add(item.id));
          }
        }
      });
      
      setSelectedItems(newSelected);
      console.log(`[Step2:Grouper] rubberBandSelect | selected=${newSelected.size}`);
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionBox(null);
      setActiveContainer(null);
      setSelectionThresholdMet(false);
      currentContainerRef.current = null;
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isSelecting, selectionStart, selectionBox, selectedItems, groupedItems]);

  // Click-outside: deselect everything when clicking on neutral canvas area
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.item-card, .product-group-card, .group-header, .toolbar, button, [role="button"]')) {
        if (selectedItems.size > 0) updateSelection(new Set());
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedItems]);

  // Initialize items with individual groups and auto-upload.
  // IMPORTANT: Only process items that are genuinely new (not already in groupedItems).
  // This prevents the items prop feedback loop from resetting group state every time
  // onGrouped() is called (which triggers a re-render with updated items).
  useEffect(() => {
    const initializeItems = async () => {
      // Determine which items are already tracked locally
      const existingIds = new Set(groupedItems.map(i => i.id));

      // Only process truly new items
      const newItems = items.filter(item => !existingIds.has(item.id));

      // If nothing is new, just sync categories/metadata that may have changed externally
      // (e.g. category assigned via CategoryZones, or group merge from category click).
      if (newItems.length === 0) {
        setGroupedItems(prev =>
          prev.map(existing => {
            const updated = items.find(i => i.id === existing.id);
            if (!updated) return existing;
            // Allow productGroup to update from props ONLY when the incoming value differs
            // from the item's own id — meaning an external merge/group was applied
            // (e.g. category click in CategoryZones merged items into one group).
            // Keep local productGroup when the prop still shows the item's own id (default singleton).
            const incomingGroup = updated.productGroup || updated.id;
            const newGroup = incomingGroup !== updated.id ? incomingGroup : existing.productGroup;
            return { ...updated, productGroup: newGroup };
          })
        );
        return;
      }

      // Find truly new images that need uploading (have file but not uploaded yet)
      const toUpload = newItems.filter(item => {
        if (uploadedImages.has(item.id)) return false;
        const hasSupabaseUrl = item.imageUrls?.length || (item.preview && item.preview.startsWith('https://'));
        if (hasSupabaseUrl) return false;
        if (!item.file) return false;
        return true;
      });

      if (toUpload.length > 0) {
        setIsLoading(true);
        setLoadingProgress(0);
        setLoadingMessage(`Uploading ${toUpload.length} image${toUpload.length > 1 ? 's' : ''}...`);
      }

      const incoming: ClothingItem[] = [];
      let processedCount = 0;

      for (const item of newItems) {
        const hasSupabaseUrl = item.imageUrls?.length || (item.preview && item.preview.startsWith('https://'));

        if (uploadedImages.has(item.id) || hasSupabaseUrl) {
          incoming.push({ ...item, productGroup: item.productGroup || item.id });
          continue;
        }

        if (item.preview && item.preview.startsWith('blob:') && !item.file) {
          console.warn('⚠️ Item has expired blob URL but no file to re-upload:', item.id);
          continue;
        }

        if (userId && item.file) {
          const uploaded = await uploadImageImmediately(item, userId);
          if (uploaded) {
            setUploadedImages(prev => new Set(prev).add(item.id));
            incoming.push({ ...uploaded, productGroup: uploaded.productGroup || uploaded.id });
          } else {
            incoming.push({ ...item, productGroup: item.productGroup || item.id });
          }
        } else {
          incoming.push({ ...item, productGroup: item.productGroup || item.id });
        }

        if (toUpload.length > 0) {
          processedCount++;
          const progress = (processedCount / toUpload.length) * 100;
          setLoadingProgress(progress);
          setLoadingMessage(progress < 100
            ? `Uploading image ${processedCount} of ${toUpload.length}...`
            : 'Upload complete!');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Append new items; deduplicate by ID to prevent React key collisions
      setGroupedItems(prev => {
        const existingIdSet = new Set(prev.map(i => i.id));
        const deduped = incoming.filter(i => !existingIdSet.has(i.id));
        return [...prev, ...deduped];
      });

      if (toUpload.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        setIsLoading(false);
        setLoadingProgress(0);
      }
    };

    initializeItems();
  }, [items]);

  // Auto-upload image to Supabase Storage
  const uploadImageImmediately = async (item: ClothingItem, userId: string) => {
    try {
      // Safety check: if no valid file with name, return item as-is (already uploaded or corrupted)
      if (!item.file || !item.file.name || typeof item.file.name !== 'string') {
        return item;
      }
      
      const fileExt = item.file.name.split('.').pop();
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `${Date.now()}-${randomId}.${fileExt}`;
      // Use permanent path (userId/productId/...) so the URL in DB remains valid indefinitely.
      const filePath = `${userId}/${item.id}/${fileName}`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(filePath, item.file, {
          cacheControl: '3600',
          upsert: true, // Allow overwriting if exists
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

  // Click-to-Select functionality (with Shift+Click for multi-select)
  // Helper: update selection state and notify parent so CategoryZones can use it
  const updateSelection = (next: Set<string>) => {
    setSelectedItems(next);
    onSelectionChange?.(next);
  };

  // Toggle all items in a product group in/out of selection
  const toggleGroupSelection = (groupItems: ClothingItem[]) => {
    const groupIds = groupItems.map(i => i.id);
    const allSelected = groupIds.every(id => selectedItems.has(id));
    const next = new Set(selectedItems);
    if (allSelected) {
      groupIds.forEach(id => next.delete(id));
    } else {
      groupIds.forEach(id => next.add(id));
    }
    updateSelection(next);
  };

  const toggleItemSelection = (itemId: string, e?: React.MouseEvent) => {
    const newSelected = new Set(selectedItems);
    const action = newSelected.has(itemId) ? 'deselect' : 'select';
    console.log(`[Step2:Grouper] toggleSelect | ${action} id=${itemId} | shift=${!!e?.shiftKey} | totalAfter=${newSelected.size + (action === 'select' ? 1 : -1)}`);
    
    if (e?.shiftKey) {
      if (newSelected.has(itemId)) newSelected.delete(itemId);
      else newSelected.add(itemId);
    } else {
      // Regular click — toggle this item in/out of selection (not replace)
      if (newSelected.has(itemId)) newSelected.delete(itemId);
      else newSelected.add(itemId);
    }
    
    updateSelection(newSelected);
  };

  // Rectangle selection box handlers
  const handleMouseDown = (e: React.MouseEvent, containerRef: HTMLElement | null, containerType: 'singles' | 'groups') => {
    const target = e.target as HTMLElement;
    
    // Don't start selection if clicking on interactive elements OR on cards/images
    if (target.closest('button') || 
        target.closest('input') || 
        target.closest('a') ||
        target.closest('.single-item-card') ||
        target.closest('.product-group-card') ||
        target.closest('.group-image-item') ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'A' ||
        target.tagName === 'IMG') {
      return;
    }

    if (!containerRef) return;
    
    const rect = containerRef.getBoundingClientRect();
    const startX = e.clientX - rect.left + containerRef.scrollLeft;
    const startY = e.clientY - rect.top + containerRef.scrollTop;
    
    currentContainerRef.current = containerRef;
    setIsSelecting(true);
    setSelectionStart({ x: startX, y: startY });
    setActiveContainer(containerType);
    
    // Clear selection if not holding shift
    if (!e.shiftKey) {
      updateSelection(new Set());
    }
  };

  // Create group from selected items — requires at least 2 items to be meaningful
  const createGroupFromSelected = () => {
    if (selectedItems.size < 2) {
      alert('Please select at least 2 items to group together');
      return;
    }
    console.log(`[Step2:Grouper] createGroup | selected=${selectedItems.size}`);

    const groupId = crypto.randomUUID();
    const updated = groupedItems.map(item =>
      selectedItems.has(item.id)
        ? { ...item, productGroup: groupId }
        : item
    );

    setGroupedItems(updated);
    updateSelection(new Set());
    onGrouped(updated);
  };

  // Ungroup selected items
  const ungroupSelected = () => {
    if (selectedItems.size === 0) {
      alert('Please select items to ungroup');
      return;
    }
    console.log(`[Step2:Grouper] ungroupSelected | selected=${selectedItems.size}`);

    const updated = groupedItems.map(item =>
      selectedItems.has(item.id)
        ? { ...item, productGroup: item.id, category: undefined }
        : item
    );

    setGroupedItems(updated);
    updateSelection(new Set());
    onGrouped(updated);
  };


  // Drag and Drop Handlers for Images
  const handleDragStart = (e: React.DragEvent, item: ClothingItem, fromGroup: string) => {
    console.log(`[Step2:Grouper] dragStart | item=${item.id} fromGroup=${fromGroup}`);
    setDraggedItem(item);
    setDraggedFromGroup(fromGroup);
    // Set data for cross-component dragging (Step 2 -> Step 3)
    const dragData = {
      item,
      productGroup: item.productGroup || item.id,
      source: 'ImageGrouper'
    };
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetGroup: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroup(targetGroup);
  };

  const handleDrop = (e: React.DragEvent, targetGroup: string) => {
    e.preventDefault();
    e.stopPropagation();

    // Resolve which item is being dragged — could come from:
    //   1. handleDragStart (whole-card drag) → draggedItem is set
    //   2. handlePhotoDragStart (photo inside a group) → draggedPhotoId is set
    let movingItem = draggedItem;
    let sourceGroup = draggedFromGroup;

    if (!movingItem && draggedPhotoId) {
      movingItem = groupedItems.find(i => i.id === draggedPhotoId) || null;
      sourceGroup = draggedPhotoGroupId;
    }

    // Also check the dataTransfer payload (cross-component / cross-render safety)
    if (!movingItem) {
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        if (data.action === 'reorder-photo' && data.photoId) {
          movingItem = groupedItems.find(i => i.id === data.photoId) || null;
          sourceGroup = data.groupId;
        } else if (data.item?.id) {
          movingItem = groupedItems.find(i => i.id === data.item.id) || null;
          sourceGroup = data.productGroup || data.item.productGroup || data.item.id;
        }
      } catch { /* ignore */ }
    }

    if (!movingItem) {
      setDragOverGroup(null);
      return;
    }

    // No-op: dropped on its own group
    if (sourceGroup === targetGroup) {
      setDragOverGroup(null);
      setDraggedItem(null);
      setDraggedFromGroup(null);
      setDraggedPhotoId(null);
      setDraggedPhotoGroupId(null);
      return;
    }

    console.log(`[Step2:Grouper] drop | item=${movingItem.id} from=${sourceGroup} → to=${targetGroup}`);
    const afterMove = groupedItems.map(item =>
      item.id === movingItem!.id
        ? { ...item, productGroup: targetGroup }
        : item
    );

    // If the source group is now down to 1 item, dissolve it back to a singleton
    const sourceGroupItems = afterMove.filter(i => (i.productGroup || i.id) === sourceGroup);
    const updated = sourceGroupItems.length === 1
      ? afterMove.map(item =>
          (item.productGroup || item.id) === sourceGroup
            ? { ...item, productGroup: item.id }
            : item
        )
      : afterMove;

    setGroupedItems(updated);
    onGrouped(updated);
    updateSelection(new Set());
    setDraggedItem(null);
    setDraggedFromGroup(null);
    setDraggedPhotoId(null);
    setDraggedPhotoGroupId(null);
    setDragOverGroup(null);
    setDragOverPhotoId(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDraggedFromGroup(null);
    setDragOverGroup(null);
  };

  // ── Photo reorder handlers (drag photos within a group) ──────────────────
  const handlePhotoDragStart = (e: React.DragEvent, item: ClothingItem, groupId: string) => {
    console.log(`[Step2:Grouper] photoDragStart | photo=${item.id} group=${groupId}`);
    e.stopPropagation();
    setDraggedPhotoId(item.id);
    setDraggedPhotoGroupId(groupId);
    e.dataTransfer.setData('application/json', JSON.stringify({ action: 'reorder-photo', photoId: item.id, groupId }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePhotoDragOver = (e: React.DragEvent, photoId: string, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedPhotoGroupId === groupId && draggedPhotoId !== photoId) {
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
    srcGroupId = srcGroupId || draggedPhotoGroupId;

    // Cross-group drop — delegate to handleDrop which now resolves photo drags too
    if (srcGroupId && srcGroupId !== groupId) {
      handleDrop(e, groupId);
      return;
    }

    // Same-group reorder
    if (!srcPhotoId || !srcGroupId || srcGroupId !== groupId || srcPhotoId === targetPhotoId) {
      setDraggedPhotoId(null); setDraggedPhotoGroupId(null); setDragOverPhotoId(null);
      return;
    }

    const photoList = [...groupedItems.filter(i => (i.productGroup || i.id) === groupId)];
    const fromIdx = photoList.findIndex(p => p.id === srcPhotoId);
    const toIdx = photoList.findIndex(p => p.id === targetPhotoId);
    if (fromIdx === -1 || toIdx === -1) return;

    const moved = photoList.splice(fromIdx, 1)[0];
    photoList.splice(toIdx, 0, moved);

    let slot = 0;
    const updated = groupedItems.map(i => {
      if ((i.productGroup || i.id) !== groupId) return i;
      return photoList[slot++];
    });
    setGroupedItems(updated);
    onGrouped(updated);
    setDraggedPhotoId(null); setDraggedPhotoGroupId(null); setDragOverPhotoId(null);
  };

  const handlePhotoDragEnd = () => {
    setDraggedPhotoId(null);
    setDraggedPhotoGroupId(null);
    setDragOverPhotoId(null);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only clear drag over if we're leaving the container, not just moving between children
    if (e.currentTarget === e.target) {
      setDragOverGroup(null);
    }
  };

  // Delete image handler
  const handleDeleteImage = async (item: ClothingItem) => {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    console.log(`[Step2:Grouper] deleteImage | item=${item.id} storagePath=${item.storagePath}`);

    // Delete from storage if it was uploaded
    if (item.storagePath) {
      await deleteImageFromStorage(item.storagePath);
      // Delete the product_images row
      await supabase.from('product_images').delete().eq('storage_path', item.storagePath);
    }
    // Delete the products row (cleans up orphaned DB entries)
    await supabase.from('products').delete().eq('id', item.id);

    // Remove from UI
    const updated = groupedItems.filter(i => i.id !== item.id);
    setGroupedItems(updated);
    onGrouped(updated);
    setUploadedImages(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    // Notify parent that a real DB change happened — Library should refresh
    onImageDeleted?.();
  };

  // Bulk delete selected items
  const handleDeleteSelected = async () => {
    if (selectedItems.size === 0) return;
    if (!confirm(`Delete ${selectedItems.size} selected image${selectedItems.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    console.log(`[Step2:Grouper] deleteSelected | count=${selectedItems.size}`);

    const toDelete = groupedItems.filter(i => selectedItems.has(i.id));
    const storagePaths = toDelete.map(i => i.storagePath).filter(Boolean) as string[];
    const deletedIds = toDelete.map(i => i.id);

    // Delete from storage in parallel
    await Promise.all(storagePaths.map(p => deleteImageFromStorage(p)));

    // Delete product_images rows by storage_path
    if (storagePaths.length > 0) {
      await supabase.from('product_images').delete().in('storage_path', storagePaths);
    }
    // Delete products rows by id (removes orphaned DB entries)
    if (deletedIds.length > 0) {
      await supabase.from('products').delete().in('id', deletedIds);
    }

    const updated = groupedItems.filter(i => !selectedItems.has(i.id));
    setGroupedItems(updated);
    updateSelection(new Set());
    onGrouped(updated);

    // Notify parent that real DB changes happened — Library should refresh
    onImageDeleted?.();
  };

  const groups = getGroups();
  const groupEntries = Object.entries(groups);
  
  const multiItemGroups = groupEntries.filter(([_, items]) => items.length > 1);
  const singleItems = groupEntries.filter(([_, items]) => items.length === 1).flatMap(([_, items]) => items);

  // Notify parent whenever the group stats change so Step 3 can show matching numbers
  useEffect(() => {
    onStatsChange?.({
      multiImageGroups: multiItemGroups.length,
      singles: singleItems.length,
      totalListings: multiItemGroups.length + singleItems.length,
      totalImages: groupedItems.length,
    });
  }, [multiItemGroups.length, singleItems.length, groupedItems.length, onStatsChange]);

  return (
    <>
      {isLoading && (
        <LoadingProgress 
          progress={loadingProgress} 
          message={loadingMessage} 
        />
      )}
      
      <div className="image-grouper-container">
      <div className="grouper-header">
        <div className="stats">
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={20} /> {multiItemGroups.length} Multi-Image Groups
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Image size={20} /> {singleItems.length} Single Items
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#6366f1' }}>
            <Package size={20} /> {multiItemGroups.length + singleItems.length} Total Listings
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Image size={20} /> {groupedItems.length} Total Images
          </span>
          {selectedItems.size > 0 && (
            <span style={{ background: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Check size={16} /> {selectedItems.size} Selected
            </span>
          )}
        </div>
      </div>

      {/* Grouping Controls */}
      <div className="grouper-actions">
        <button 
          className="button button-primary" 
          onClick={createGroupFromSelected}
          disabled={selectedItems.size < 1}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Link2 size={16} /> Group Selected ({selectedItems.size})
        </button>
        <button 
          className="button button-secondary" 
          onClick={ungroupSelected}
          disabled={selectedItems.size === 0}
          title="Remove selected images from their groups"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Scissors size={16} /> Ungroup Selected
        </button>
        <button 
          className="button button-secondary" 
          onClick={() => updateSelection(new Set())}
          disabled={selectedItems.size === 0}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <X size={16} /> Clear Selection
        </button>
        <button
          className="button"
          onClick={handleDeleteSelected}
          disabled={selectedItems.size === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            background: selectedItems.size > 0 ? '#ef4444' : undefined,
            color: selectedItems.size > 0 ? '#fff' : undefined,
            border: 'none',
          }}
          title="Permanently delete all selected images"
        >
          <Trash2 size={16} /> Delete Selected ({selectedItems.size})
        </button>
      </div>

      {/* Individual Items Section - Always Visible Drop Zone */}
      <div 
        className="singles-section"
        onMouseDown={(e) => {
          // Allow selection to start from section wrapper area (margins, padding, etc)
          const target = e.target as HTMLElement;
          // Don't interfere with buttons, but handle empty areas
          if (!target.closest('button') && 
              !target.closest('.delete-image-btn') &&
              !target.closest('.drop-zone-placeholder') &&
              !target.closest('.items-grid')) {
            handleMouseDown(e, singlesContainerRef.current, 'singles');
          }
        }}
      >
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Image size={20} /> Individual Items ({singleItems.length})
        </h3>
        
        {/* Drop Zone - Always visible */}
        <div 
          className={`drop-zone-placeholder ${dragOverGroup === 'individuals' ? 'drag-over' : ''}`}
          onDragOver={(e) => handleDragOver(e, 'individuals')}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (!draggedItem) return;
            
            // Make the item individual by giving it its own productGroup (its ID)
            const updated = groupedItems.map(item =>
              item.id === draggedItem.id
                ? { ...item, productGroup: item.id }
                : item
            );
            
            setGroupedItems(updated);
            onGrouped(updated);
            setDraggedItem(null);
            setDraggedFromGroup(null);
            setDragOverGroup(null);
          }}
          onDragLeave={handleDragLeave}
        >
          <div className="drop-zone-content">
            <ArrowDown size={24} className="drop-zone-icon" />
            <p>Drag photos here to make them individual items</p>
          </div>
        </div>

        {/* Items Grid */}
        {singleItems.length > 0 && (
          <div 
            ref={singlesContainerRef}
            className="items-grid selection-container"
            onMouseDown={(e) => handleMouseDown(e, singlesContainerRef.current, 'singles')}
          >
            {/* Selection Box Visualization */}
            {isSelecting && selectionBox && activeContainer === 'singles' && selectionThresholdMet && (
              <div
                className="selection-box"
                style={{
                  position: 'absolute',
                  left: `${selectionBox.x}px`,
                  top: `${selectionBox.y}px`,
                  width: `${selectionBox.width}px`,
                  height: `${selectionBox.height}px`,
                  pointerEvents: 'none'
                }}
              />
            )}
            
            {singleItems.map((item) => {
              const itemGroupId = item.productGroup || item.id;
              return (
                <div
                  key={item.id}
                  data-item-id={item.id}
                  className={`single-item-card ${dragOverGroup === itemGroupId ? 'drag-over' : ''} ${item.category ? 'has-category' : ''}`}
                  draggable={!selectionThresholdMet}
                  onDragStart={(e) => {
                    // If selection threshold is met, don't allow dragging
                    if (selectionThresholdMet) {
                      e.preventDefault();
                      return;
                    }
                    handleDragStart(e, item, itemGroupId);
                  }}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, itemGroupId)}
                  onDrop={(e) => handleDrop(e, itemGroupId)}
                  onDragLeave={handleDragLeave}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('.delete-image-btn')) {
                      toggleItemSelection(item.id, e);
                    }
                  }}
                  onDoubleClick={() => setLightboxSrc(item.preview || item.imageUrls?.[0] || '')}
                >
                  {item.category && (
                    <div className="category-indicator-small" style={{ display: 'none' }}>
                      <Check size={12} className="category-check" />
                    </div>
                  )}
                  {(item.preview || item.imageUrls?.[0]) && (
                    <img 
                      src={item.preview || item.imageUrls?.[0]} 
                      alt="Product" 
                      draggable={false}
                    />
                  )}
                  {selectedItems.has(item.id) && (
                    <div className="selection-indicator"><Check size={20} /></div>
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
        )}
      </div>

      {/* Product Groups */}
      {multiItemGroups.length > 0 && (
        <div 
          className="groups-section"
          onMouseDown={(e) => {
            // Allow selection to start from section wrapper area (margins, padding, etc)
            const target = e.target as HTMLElement;
            // Don't interfere with buttons, but handle empty areas
            if (!target.closest('button') &&
                !target.closest('.groups-grid')) {
              handleMouseDown(e, groupsContainerRef.current, 'groups');
            }
          }}
        >
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={20} /> Product Groups ({multiItemGroups.length})
          </h3>
          <div 
            ref={groupsContainerRef}
            className="groups-grid selection-container"
            onMouseDown={(e) => handleMouseDown(e, groupsContainerRef.current, 'groups')}
          >
            {/* Selection Box Visualization */}
            {isSelecting && selectionBox && activeContainer === 'groups' && selectionThresholdMet && (
              <div
                className="selection-box"
                style={{
                  position: 'absolute',
                  left: `${selectionBox.x}px`,
                  top: `${selectionBox.y}px`,
                  width: `${selectionBox.width}px`,
                  height: `${selectionBox.height}px`,
                  pointerEvents: 'none'
                }}
              />
            )}
            
            {multiItemGroups.map(([groupId, items]) => (
              <div
                key={groupId}
                data-group-id={groupId}
                className={`product-group-card ${dragOverGroup === groupId ? 'drag-over' : ''} ${items[0].category ? 'has-category' : ''} ${items.every(i => selectedItems.has(i.id)) ? 'all-selected' : items.some(i => selectedItems.has(i.id)) ? 'some-selected' : ''}`}
                draggable={!selectionThresholdMet}
                onDragStart={(e) => {
                  if (selectionThresholdMet) { e.preventDefault(); return; }
                  // Drag the whole group to a CategoryZone
                  const dragData = {
                    item: items[0],
                    productGroup: groupId,
                    source: 'ImageGrouper',
                  };
                  e.dataTransfer.setData('application/json', JSON.stringify(dragData));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverGroup(groupId);
                }}
                onDrop={(e) => handleDrop(e, groupId)}
                onDragLeave={handleDragLeave}
              >
                {items[0].category && (
                  <div className="category-indicator" style={{ display: 'none' }}>
                    <Check size={14} className="category-check" />
                    <span className="category-label">{items[0].category}</span>
                  </div>
                )}
                <div
                  className={`group-header${items.every(i => selectedItems.has(i.id)) ? ' all-selected' : items.some(i => selectedItems.has(i.id)) ? ' some-selected' : ''}`}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('button')) {
                      toggleGroupSelection(items);
                    }
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title="Click to select/deselect all images in this group"
                >
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
                      className={`group-image-item ${selectedItems.has(item.id) ? 'selected' : ''} ${dragOverPhotoId === item.id && draggedPhotoGroupId === groupId ? 'photo-drag-over' : ''} ${draggedPhotoId === item.id ? 'photo-dragging' : ''}`}
                      draggable
                      onDragStart={(e) => handlePhotoDragStart(e, item, groupId)}
                      onDragOver={(e) => handlePhotoDragOver(e, item.id, groupId)}
                      onDrop={(e) => handlePhotoDrop(e, item.id, groupId)}
                      onDragEnd={handlePhotoDragEnd}
                      onDragLeave={() => setDragOverPhotoId(null)}
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest('.delete-image-btn')) {
                          toggleItemSelection(item.id, e);
                        }
                      }}
                      onDoubleClick={() => setLightboxSrc(item.preview || item.imageUrls?.[0] || '')}
                    >
                      {(item.preview || item.imageUrls?.[0]) && (
                        <img 
                          src={item.preview || item.imageUrls?.[0]} 
                          alt="Product" 
                          draggable={false}
                        />
                      )}
                      {selectedItems.has(item.id) && (
                        <div className="selection-indicator"><Check size={20} /></div>
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

      {/* Lightbox modal */}
      {lightboxSrc && (
        <div
          className="lightbox-overlay"
          onClick={() => setLightboxSrc(null)}
        >
          <button className="lightbox-close" onClick={() => setLightboxSrc(null)}>✕</button>
          <img
            src={lightboxSrc}
            alt="Full size preview"
            className="lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
};

export default ImageGrouper;