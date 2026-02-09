import { useState, useEffect, useRef } from 'react';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import { Package, Image, Link2, Scissors, X, ArrowDown, Check } from 'lucide-react';
import LoadingProgress from './LoadingProgress';
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
  
  // Loading progress state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');
  
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

  // Initialize items with individual groups and auto-upload
  useEffect(() => {
    const initializeItems = async () => {
      const newImages = items.filter(item => !uploadedImages.has(item.id));
      
      if (newImages.length > 0) {
        setIsLoading(true);
        setLoadingProgress(0);
        setLoadingMessage(`Loading ${newImages.length} image${newImages.length > 1 ? 's' : ''}...`);
      }
      
      const initialized: ClothingItem[] = [];
      let processedCount = 0;
      
      for (const item of items) {
        // Check if already uploaded (has imageUrls or Supabase preview URL) or already tracked
        const hasSupabaseUrl = item.imageUrls?.length || (item.preview && item.preview.startsWith('https://'));
        
        // If already has permanent Supabase URL, skip upload
        if (uploadedImages.has(item.id) || hasSupabaseUrl) {
          initialized.push({ ...item, productGroup: item.productGroup || item.id });
          continue;
        }

        // Handle items with blob URLs (expired temporary URLs) - need to re-upload
        // But we can't re-upload without the original file
        if (item.preview && item.preview.startsWith('blob:') && !item.file) {
          console.warn('⚠️ Item has expired blob URL but no file to re-upload:', item.id);
          // Skip this item - it's broken and can't be recovered
          continue;
        }

        // Upload to Supabase Storage immediately (only if has file)
        if (userId && item.file) {
          const uploaded = await uploadImageImmediately(item, userId);
          if (uploaded) {
            setUploadedImages(prev => new Set(prev).add(item.id));
            initialized.push({ ...uploaded, productGroup: uploaded.productGroup || uploaded.id });
          } else {
            initialized.push({ ...item, productGroup: item.productGroup || item.id });
          }
        } else {
          // Item doesn't have file (restored from database) - use as-is
          initialized.push({ ...item, productGroup: item.productGroup || item.id });
        }
        
        // Update progress
        processedCount++;
        const progress = (processedCount / newImages.length) * 100;
        setLoadingProgress(progress);
        
        if (progress < 100) {
          setLoadingMessage(`Loading image ${processedCount} of ${newImages.length}...`);
        } else {
          setLoadingMessage('All images loaded!');
        }
        
        // Small delay to allow animation to be visible
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      setGroupedItems(initialized);
      
      // Show completion message for 2.5 seconds so users can see it
      if (newImages.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 2500));
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
      const filePath = `${userId}/temp/${fileName}`;

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
  const toggleItemSelection = (itemId: string, e?: React.MouseEvent) => {
    const newSelected = new Set(selectedItems);
    
    // If shift key is held, keep existing selection and add/remove this item
    if (e?.shiftKey) {
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
    } else {
      // Normal click - toggle only this item
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
    }
    
    setSelectedItems(newSelected);
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
      setSelectedItems(new Set());
    }
  };

  // Create group from selected items (allow single items too)
  const createGroupFromSelected = () => {
    if (selectedItems.size < 1) {
      alert('Please select at least 1 item to group');
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
    
    if (!draggedItem) {
      setDragOverGroup(null);
      return;
    }

    // Don't do anything if dropping on the same group
    if (draggedFromGroup === targetGroup) {
      setDragOverGroup(null);
      setDraggedItem(null);
      setDraggedFromGroup(null);
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
            <Package size={20} /> {multiItemGroups.length} Product Groups
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Image size={20} /> {singleItems.length} Single Items
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
          onClick={() => setSelectedItems(new Set())}
          disabled={selectedItems.size === 0}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <X size={16} /> Clear Selection
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
                >
                  {item.category && (
                    <div className="category-indicator-small">
                      <Check size={12} className="category-check" />
                    </div>
                  )}
                  <img 
                    src={item.preview} 
                    alt="Product" 
                    draggable={false}
                  />
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
                className={`product-group-card ${dragOverGroup === groupId ? 'drag-over' : ''} ${items[0].category ? 'has-category' : ''}`}
                onDragOver={(e) => handleDragOver(e, groupId)}
                onDrop={(e) => handleDrop(e, groupId)}
                onDragLeave={handleDragLeave}
              >
                {items[0].category && (
                  <div className="category-indicator">
                    <Check size={14} className="category-check" />
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
                          toggleItemSelection(item.id, e);
                        }
                      }}
                    >
                      <img 
                        src={item.preview} 
                        alt="Product" 
                        draggable={false}
                      />
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
    </>
  );
};

export default ImageGrouper;
