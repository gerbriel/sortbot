import React, { useState, useEffect, useRef } from 'react';
import { fetchWorkflowBatches, type WorkflowBatch } from '../lib/workflowBatchService';
import { 
  deleteProductGroup, 
  deleteImage, 
  updateBatchMetadata,
  duplicateBatch,
  fetchSavedProducts,
  fetchSavedImages,
  deleteBatchWithCascade,
  assignImagesToGroup,
  groupLooseImagesIntoNewGroup,
} from '../lib/libraryService';
import { Folder, Calendar, Image, Layers, Tag, ArrowRight, Trash2, X, Grid3x3, Package, Edit2, Copy, Check } from 'lucide-react';
import type { ClothingItem } from '../App';
import './Library.css';

type ViewMode = 'batches' | 'groups' | 'images';

interface ProductGroup {
  id: string;
  title: string;
  category: string;
  images: string[];
  itemCount: number;
  createdAt: string;
  isSaved?: boolean; // Track if from database vs workflow_state
}

interface ImageRecord {
  id: string;
  preview: string;
  category?: string;
  productGroup?: string;
  batchNumber?: string;
  brand?: string;
  size?: string;
  condition?: string;
  tags?: string[];
  createdAt: string;
  isSaved?: boolean; // Track if from database vs workflow_state
}

interface LibraryProps {
  userId: string;
  onClose: () => void;
  onOpenBatch: (batch: WorkflowBatch) => void;
}

export const Library: React.FC<LibraryProps> = ({ userId, onClose, onOpenBatch }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('batches');
  const [batches, setBatches] = useState<WorkflowBatch[]>([]);
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  
  // Deletion progress state
  const [deletingItem, setDeletingItem] = useState<{id: string, type: 'batch' | 'group' | 'image', progress: number} | null>(null);
  
  const [editingBatch, setEditingBatch] = useState<string | null>(null);
  const [editBatchName, setEditBatchName] = useState<string>('');
  
  // Selection and drag-drop state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  
  // Selection box state (for drag-to-select)
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectionThresholdMet, setSelectionThresholdMet] = useState(false);

  // Assign / group loose images modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [assignTargetGroupId, setAssignTargetGroupId] = useState('');
  const [assignWorking, setAssignWorking] = useState(false);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStep, setFilterStep] = useState('');         // batches: step 1-5
  const [filterCategory, setFilterCategory] = useState(''); // groups: category
  const [filterBatchId, setFilterBatchId] = useState('');   // images: by batch
  const [filterGroupId, setFilterGroupId] = useState('');   // images: by group
  const [filterUnassigned, setFilterUnassigned] = useState(false); // images: unassigned only
  const [filterBrand, setFilterBrand] = useState('');       // images: by brand
  const [filterSize, setFilterSize] = useState('');         // images: by size
  const [filterCondition, setFilterCondition] = useState(''); // images: by condition
  
  // Refs for selection containers
  const batchesGridRef = useRef<HTMLDivElement>(null);
  const groupsGridRef = useRef<HTMLDivElement>(null);
  const imagesGridRef = useRef<HTMLDivElement>(null);
  const currentContainerRef = useRef<HTMLElement | null>(null);
  
  const SELECTION_THRESHOLD = 5; // pixels - must move this much to activate selection

  useEffect(() => {
    if (viewMode === 'batches') {
      loadBatches();
    } else if (viewMode === 'groups') {
      loadProductGroups();
    } else if (viewMode === 'images') {
      loadImages();
    }
  }, [userId, viewMode]);
  
  // Clear selection AND filters when switching views
  useEffect(() => {
    setSelectedItems(new Set());
    setSearchQuery('');
    setFilterStep('');
    setFilterCategory('');
    setFilterBatchId('');
    setFilterGroupId('');
    setFilterUnassigned(false);
    setFilterBrand('');
    setFilterSize('');
    setFilterCondition('');
  }, [viewMode]);

  const loadBatches = async () => {
    setLoading(true);
    const data = await fetchWorkflowBatches();
    setBatches(data);
    setLoading(false);
  };

  const loadProductGroups = async () => {
    setLoading(true);
    try {
      const groups: ProductGroup[] = [];
      
      // 1. Load products from workflow_batches.workflow_state
      const batches = await fetchWorkflowBatches();
      batches.forEach(batch => {
        const items = batch.workflow_state?.processedItems || 
                     batch.workflow_state?.sortedImages || 
                     batch.workflow_state?.groupedImages || [];
        
        // Group items by productGroup
        const groupMap = new Map<string, ClothingItem[]>();
        items.forEach((item: ClothingItem) => {
          const groupId = item.productGroup || item.id;
          if (!groupMap.has(groupId)) {
            groupMap.set(groupId, []);
          }
          groupMap.get(groupId)!.push(item);
        });
        
        // Convert to ProductGroup objects
        groupMap.forEach((groupItems, groupId) => {
          const firstItem = groupItems[0];
          groups.push({
            id: groupId,
            title: firstItem.seoTitle || 'Untitled Product',
            category: firstItem.category || 'Uncategorized',
            images: groupItems.map(item => item.preview || item.imageUrls?.[0] || '').filter(Boolean),
            itemCount: groupItems.length,
            createdAt: batch.created_at,
          });
        });
      });
      
      // 2. Load saved products from database
      const savedProducts = await fetchSavedProducts();
      
      savedProducts.forEach((product: any) => {
        groups.push({
          id: product.id,
          title: product.title || product.seo_title || 'Untitled Product',
          category: product.product_category || 'Uncategorized',
          images: (product.product_images || [])
            .sort((a: any, b: any) => a.position - b.position)
            .map((img: any) => img.image_url)
            .filter(Boolean),
          itemCount: product.product_images?.length || 0,
          createdAt: product.created_at,
          isSaved: true, // Mark as saved
        });
      });
      
      // Remove duplicates by ID only - same product appearing in both workflow_state and database
      // Do NOT deduplicate by title - multiple products can legitimately have the same title
      const groupMap = new Map<string, ProductGroup>();
      groups.forEach(group => {
        const existing = groupMap.get(group.id);
        
        // If no existing, or existing is not saved but this one is, use this one
        if (!existing || (!existing.isSaved && group.isSaved)) {
          groupMap.set(group.id, group);
        }
      });
      
      setProductGroups(Array.from(groupMap.values()));
    } catch (error) {
      // Silent error handling
    }
    setLoading(false);
  };

  const loadImages = async () => {
    setLoading(true);
    try {
      const imageList: ImageRecord[] = [];
      
      // Load ONLY saved images from database (not workflow_state)
      // This gives us a true 1:1 representation of the product_images table
      const savedImages = await fetchSavedImages();
      
      savedImages.forEach((img: any) => {
        imageList.push({
          id: img.id, // Use database ID, not image URL
          preview: img.image_url,
          category: img.products?.product_category,
          productGroup: img.products?.id,
          batchNumber: img.products?.batch_id,
          brand: img.products?.vendor,
          size: img.products?.size,
          condition: img.products?.condition,
          tags: img.products?.tags,
          createdAt: img.created_at,
          isSaved: true,
        });
      });
      
      // NO deduplication for Images view!
      // Each row in product_images should appear in the library,
      // even if multiple products share the same image URL.
      // Deduplication should only happen at the Product Groups level.
      setImages(imageList);
    } catch (error) {
      // Silent error handling
    }
    setLoading(false);
  };

  const handleDelete = async (batchId: string) => {
    // Start deletion animation
    setDeletingItem({id: batchId, type: 'batch', progress: 0});
    setDeleteConfirm(null);
    
    // Animate progress
    const animationDuration = 2000; // 2 seconds
    const steps = 20;
    const stepDuration = animationDuration / steps;
    
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      const progress = (i / steps) * 100;
      setDeletingItem({id: batchId, type: 'batch', progress});
    }
    
    // Actually delete (cascades to products + product_images)
    const success = await deleteBatchWithCascade(batchId);
    if (success) {
      setBatches(batches.filter(b => b.id !== batchId));
    }
    
    setDeletingItem(null);
  };

  const handleDeleteGroup = async (groupId: string) => {
    // Start deletion animation
    setDeletingItem({id: groupId, type: 'group', progress: 0});
    setDeleteConfirm(null);
    
    // Animate progress
    const animationDuration = 2000; // 2 seconds
    const steps = 20;
    const stepDuration = animationDuration / steps;
    
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      setDeletingItem({id: groupId, type: 'group', progress: (i / steps) * 100});
    }
    
    // Actually delete
    const success = await deleteProductGroup(groupId);
    if (success) {
      setProductGroups(productGroups.filter(g => g.id !== groupId));
    }
    
    setDeletingItem(null);
  };

  const handleDeleteImage = async (imageId: string, storagePath?: string) => {
    // Start deletion animation
    setDeletingItem({id: imageId, type: 'image', progress: 0});
    setDeleteConfirm(null);
    
    // Animate progress
    const animationDuration = 2000; // 2 seconds
    const steps = 20;
    const stepDuration = animationDuration / steps;
    
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
      setDeletingItem({id: imageId, type: 'image', progress: (i / steps) * 100});
    }
    
    // Actually delete
    const success = await deleteImage(imageId, storagePath);
    if (success) {
      setImages(images.filter(img => img.id !== imageId));
    }
    
    setDeletingItem(null);
  };

  const handleDuplicateBatch = async (batchId: string) => {
    const newBatchId = await duplicateBatch(batchId);
    if (newBatchId) {
      // Reload batches to show the duplicate
      await loadBatches();
      alert('Batch duplicated successfully!');
    } else {
      alert('Failed to duplicate batch. Please try again.');
    }
  };

  const handleEditBatchName = async (batchId: string) => {
    if (!editBatchName.trim()) {
      setEditingBatch(null);
      return;
    }

    const success = await updateBatchMetadata(batchId, {
      batch_name: editBatchName.trim(),
    });

    if (success) {
      // Update local state
      setBatches(batches.map(b => 
        b.id === batchId ? { ...b, batch_name: editBatchName.trim() } : b
      ));
      setEditingBatch(null);
      setEditBatchName('');
    } else {
      alert('Failed to update batch name. Please try again.');
    }
  };

  // Helper to get viewport-relative selection box coordinates
  const getViewportSelectionBox = () => {
    if (!selectionBox || !currentContainerRef.current) return null;
    
    const scrollTop = currentContainerRef.current.scrollTop;
    return {
      x: selectionBox.x,
      y: selectionBox.y - scrollTop, // Subtract scroll to get viewport position
      width: selectionBox.width,
      height: selectionBox.height
    };
  };

  // Selection handlers
  const handleItemClick = (itemId: string, event: React.MouseEvent) => {
    // Matches ImageGrouper behavior
    const newSelected = new Set(selectedItems);
    
    if (event.shiftKey) {
      // Shift key - keep existing selection and toggle this item
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

  const clearSelection = () => {
    setSelectedItems(new Set());
  };

  const selectAll = () => {
    if (viewMode === 'batches') {
      setSelectedItems(new Set(batches.map(b => b.id)));
    } else if (viewMode === 'groups') {
      setSelectedItems(new Set(productGroups.map(g => g.id)));
    } else if (viewMode === 'images') {
      setSelectedItems(new Set(images.map(img => img.id)));
    }
  };

  // Drag and drop handlers
  const handleDragStart = (itemId: string, event: React.DragEvent) => {
    setDraggedItem(itemId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', itemId);
  };

  const handleDragOver = (itemId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverItem(itemId);
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDrop = (targetId: string, event: React.DragEvent) => {
    event.preventDefault();
    
    if (!draggedItem || draggedItem === targetId) {
      setDraggedItem(null);
      setDragOverItem(null);
      return;
    }

    // Reorder items based on view mode
    if (viewMode === 'batches') {
      const items = [...batches];
      const draggedIndex = items.findIndex(b => b.id === draggedItem);
      const targetIndex = items.findIndex(b => b.id === targetId);
      
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [removed] = items.splice(draggedIndex, 1);
        items.splice(targetIndex, 0, removed);
        setBatches(items);
      }
    } else if (viewMode === 'groups') {
      const items = [...productGroups];
      const draggedIndex = items.findIndex(g => g.id === draggedItem);
      const targetIndex = items.findIndex(g => g.id === targetId);
      
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [removed] = items.splice(draggedIndex, 1);
        items.splice(targetIndex, 0, removed);
        setProductGroups(items);
      }
    } else if (viewMode === 'images') {
      const items = [...images];
      const draggedIndex = items.findIndex(img => img.id === draggedItem);
      const targetIndex = items.findIndex(img => img.id === targetId);
      
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [removed] = items.splice(draggedIndex, 1);
        items.splice(targetIndex, 0, removed);
        setImages(items);
      }
    }

    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  // Rubber band selection handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>, containerRef: React.RefObject<HTMLDivElement | null>) => {
    // Ignore if clicking on a button or interactive element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.closest('input')) {
      return;
    }

    currentContainerRef.current = containerRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const scrollTop = containerRef.current?.scrollTop || 0;
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top + scrollTop; // Account for current scroll position

    setIsSelecting(true);
    setSelectionStart({ x: startX, y: startY });
    setSelectionBox({ x: startX, y: startY, width: 0, height: 0 });
    setSelectionThresholdMet(false);
  };

  // Global mouse move handler
  useEffect(() => {
    const SCROLL_ZONE = 50; // pixels from edge to trigger scroll
    const SCROLL_SPEED = 10; // pixels per frame
    let scrollInterval: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isSelecting || !selectionStart || !currentContainerRef.current) return;

      const rect = currentContainerRef.current.getBoundingClientRect();
      const scrollTop = currentContainerRef.current.scrollTop;
      
      // Calculate position relative to container, accounting for scroll
      let currentX = e.clientX - rect.left;
      let currentY = e.clientY - rect.top + scrollTop;
      
      // Allow selection to extend beyond visible boundaries
      // Clamp X to reasonable bounds but allow Y to extend with scroll
      currentX = Math.max(0, Math.min(currentX, rect.width));

      const width = currentX - selectionStart.x;
      const height = currentY - selectionStart.y;

      // Check if we've moved beyond threshold
      if (!selectionThresholdMet) {
        const distance = Math.sqrt(width * width + height * height);
        if (distance >= SELECTION_THRESHOLD) {
          setSelectionThresholdMet(true);
        }
      }

      setSelectionBox({
        x: width >= 0 ? selectionStart.x : currentX,
        y: height >= 0 ? selectionStart.y : currentY,
        width: Math.abs(width),
        height: Math.abs(height)
      });

      // Auto-scroll when near edges OR outside container
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }

      const mouseY = e.clientY;
      const containerTop = rect.top;
      const containerBottom = rect.bottom;

      // Check if mouse is above container or near top edge
      if (mouseY < containerTop || (mouseY - containerTop < SCROLL_ZONE && mouseY > containerTop)) {
        // Mouse is above container or near top edge - scroll up
        scrollInterval = setInterval(() => {
          if (currentContainerRef.current) {
            currentContainerRef.current.scrollTop -= SCROLL_SPEED;
          }
        }, 16); // ~60fps
      } 
      // Check if mouse is below container or near bottom edge
      else if (mouseY > containerBottom || (containerBottom - mouseY < SCROLL_ZONE && mouseY < containerBottom)) {
        // Mouse is below container or near bottom edge - scroll down
        scrollInterval = setInterval(() => {
          if (currentContainerRef.current) {
            currentContainerRef.current.scrollTop += SCROLL_SPEED;
          }
        }, 16);
      }

      // Calculate which items are selected
      if (selectionThresholdMet) {
        // Use scroll-adjusted coordinates for both selection box and cards
        const selectionMinX = Math.min(selectionStart.x, currentX);
        const selectionMaxX = Math.max(selectionStart.x, currentX);
        const selectionMinY = Math.min(selectionStart.y, currentY);
        const selectionMaxY = Math.max(selectionStart.y, currentY);

        const cards = currentContainerRef.current.querySelectorAll('[data-item-id]');
        const newSelected = new Set<string>();

        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect();
          const itemId = card.getAttribute('data-item-id');
          
          if (!itemId) return;

          // Get card position in scroll-adjusted coordinates
          const cardScrollTop = cardRect.top - rect.top + scrollTop;
          const cardScrollBottom = cardRect.bottom - rect.top + scrollTop;
          const cardScrollLeft = cardRect.left - rect.left;
          const cardScrollRight = cardRect.right - rect.left;

          // Check if rectangles intersect (both in scroll-adjusted coordinates)
          const intersects = !(
            cardScrollRight < selectionMinX ||
            cardScrollLeft > selectionMaxX ||
            cardScrollBottom < selectionMinY ||
            cardScrollTop > selectionMaxY
          );

          if (intersects) {
            newSelected.add(itemId);
          }
        });

        setSelectedItems(newSelected);
      }
    };

    const handleMouseUp = () => {
      // Clear scroll interval
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }

      if (isSelecting) {
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionBox(null);
        setSelectionThresholdMet(false);
        currentContainerRef.current = null;
      }
    };

    if (isSelecting) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        // Clean up scroll interval on unmount
        if (scrollInterval) {
          clearInterval(scrollInterval);
        }
      };
    }
  }, [isSelecting, selectionStart, selectionThresholdMet, SELECTION_THRESHOLD]);

  // Bulk delete selected items
  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;

    const itemType = viewMode === 'batches' ? 'batch' : viewMode === 'groups' ? 'group' : 'image';
    const count = selectedItems.size;
    
    // Start deletion animation
    setDeletingItem({id: 'bulk', type: itemType, progress: 0});
    
    // Animate progress while deleting items
    const totalItems = count;
    let deletedCount = 0;
    const items = Array.from(selectedItems);
    
    // Delete items one by one with progress updates
    if (viewMode === 'batches') {
      for (const batchId of items) {
        await deleteBatchWithCascade(batchId);
        deletedCount++;
        const progress = (deletedCount / totalItems) * 100;
        setDeletingItem({id: 'bulk', type: itemType, progress});
      }
      setBatches(batches.filter(b => !selectedItems.has(b.id)));
    } else if (viewMode === 'groups') {
      for (const groupId of items) {
        await deleteProductGroup(groupId);
        deletedCount++;
        const progress = (deletedCount / totalItems) * 100;
        setDeletingItem({id: 'bulk', type: itemType, progress});
      }
      setProductGroups(productGroups.filter(g => !selectedItems.has(g.id)));
    } else if (viewMode === 'images') {
      for (const imageId of items) {
        await deleteImage(imageId);
        deletedCount++;
        const progress = (deletedCount / totalItems) * 100;
        setDeletingItem({id: 'bulk', type: itemType, progress});
      }
      setImages(images.filter(img => !selectedItems.has(img.id)));
    }
    
    // Show completion for a moment
    await new Promise(resolve => setTimeout(resolve, 800));
    
    setDeletingItem(null);
    clearSelection();
  };

  // IDs of currently selected images (used by assign/group handlers)
  const selectedImageIds = Array.from(selectedItems);

  const handleAssignToGroup = async () => {
    if (!assignTargetGroupId || selectedItems.size === 0) return;
    setAssignWorking(true);
    const success = await assignImagesToGroup(selectedImageIds, assignTargetGroupId);
    setAssignWorking(false);
    if (success) {
      // Update local state: mark images as belonging to this group
      setImages(prev => prev.map(img =>
        selectedItems.has(img.id) ? { ...img, productGroup: assignTargetGroupId } : img
      ));
      setShowAssignModal(false);
      setAssignTargetGroupId('');
      clearSelection();
    }
  };

  const handleGroupIntoNew = async () => {
    const title = newGroupTitle.trim() || 'New Group';
    if (selectedItems.size < 1) return;
    setAssignWorking(true);
    const newGroupId = await groupLooseImagesIntoNewGroup(selectedImageIds, title);
    setAssignWorking(false);
    if (newGroupId) {
      setImages(prev => prev.map(img =>
        selectedItems.has(img.id) ? { ...img, productGroup: newGroupId } : img
      ));
      setShowNewGroupModal(false);
      setNewGroupTitle('');
      clearSelection();
      // Reload groups so the new one shows up
      loadProductGroups();
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  const getStepLabel = (step: number): string => {
    const labels = {
      1: 'Upload Images',
      2: 'Group Images',
      3: 'Categorize',
      4: 'Add Descriptions',
      5: 'Save & Export',
    };
    return labels[step as keyof typeof labels] || 'Unknown';
  };

  const getStepProgress = (batch: WorkflowBatch): number => {
    return (batch.current_step / 5) * 100;
  };

  // Get thumbnail grid (2x2) from workflow state
  const getThumbnails = (batch: WorkflowBatch): string[] => {
    const items = batch.workflow_state?.uploadedImages || 
                  batch.workflow_state?.groupedImages || 
                  batch.workflow_state?.sortedImages || 
                  batch.workflow_state?.processedItems || 
                  [];
    
    return items
      .slice(0, 4)
      .map(item => item.preview || item.imageUrls?.[0] || '')
      .filter(Boolean);
  };

  // ── Derived filtered lists ──────────────────────────────────────────────────
  const filteredBatches = batches.filter(b => {
    const q = searchQuery.toLowerCase();
    const nameMatch = !q ||
      (b.batch_name || '').toLowerCase().includes(q) ||
      b.batch_number.toLowerCase().includes(q);
    const stepMatch = !filterStep || String(b.current_step) === filterStep;
    return nameMatch && stepMatch;
  });

  // Collect unique categories from product groups for the category filter dropdown
  const groupCategories = Array.from(new Set(productGroups.map(g => g.category).filter(Boolean))).sort();

  const filteredGroups = productGroups.filter(g => {
    const q = searchQuery.toLowerCase();
    const nameMatch = !q || g.title.toLowerCase().includes(q) || g.category.toLowerCase().includes(q);
    const catMatch = !filterCategory || g.category === filterCategory;
    return nameMatch && catMatch;
  });

  // Collect unique batches from images for the batch filter dropdown
  const imageBatches = Array.from(
    new Map(
      images
        .filter(img => img.batchNumber)
        .map(img => [img.batchNumber!, img.batchNumber!])
    ).entries()
  );

  // Collect unique product groups from images for the group filter dropdown
  const imageGroups = Array.from(
    new Map(
      images
        .filter(img => img.productGroup)
        .map(img => {
          const pg = productGroups.find(g => g.id === img.productGroup);
          return [img.productGroup!, pg?.title || img.productGroup!];
        })
    ).entries()
  );

  // Collect unique filter option lists for images
  const imageBrands = Array.from(new Set(images.map(img => img.brand).filter(Boolean))).sort() as string[];
  const imageSizes = Array.from(new Set(images.map(img => img.size).filter(Boolean))).sort() as string[];
  const imageConditions = Array.from(new Set(images.map(img => img.condition).filter(Boolean))).sort() as string[];

  const filteredImages = images.filter(img => {
    const batchMatch = !filterBatchId || img.batchNumber === filterBatchId;
    const groupMatch = !filterGroupId || img.productGroup === filterGroupId;
    const unassignedMatch = !filterUnassigned || !img.productGroup;
    const brandMatch = !filterBrand || img.brand === filterBrand;
    const sizeMatch = !filterSize || img.size === filterSize;
    const conditionMatch = !filterCondition || img.condition === filterCondition;
    return batchMatch && groupMatch && unassignedMatch && brandMatch && sizeMatch && conditionMatch;
  });
  // ────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="library-modal">
        <div className="library-content">
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading your library...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="library-modal" onClick={onClose}>
      <div className="library-content" onClick={(e) => e.stopPropagation()}>
        <div className="library-header">
          <div className="header-title">
            <Folder size={24} />
            <h2>Library</h2>
            {viewMode === 'batches' && (
              <span className="batch-count">({batches.length} {batches.length === 1 ? 'batch' : 'batches'})</span>
            )}
            {viewMode === 'groups' && (
              <span className="batch-count">({productGroups.length} {productGroups.length === 1 ? 'group' : 'groups'})</span>
            )}
            {viewMode === 'images' && (
              <span className="batch-count">({images.length} {images.length === 1 ? 'image' : 'images'})</span>
            )}
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Deletion Progress Overlay */}
        {deletingItem && (
          <div className="deletion-overlay">
            <div className="deletion-animation">
              <div className="deletion-message">
                {deletingItem.id === 'bulk' 
                  ? `Deleting ${deletingItem.type}s... ${Math.round(deletingItem.progress)}%`
                  : `Deleting ${deletingItem.type}... ${Math.round(deletingItem.progress)}%`
                }
              </div>
              
              <div className="deletion-track">
                {/* Clothing Rack */}
                <div className="rack-bar"></div>
                <div className="rack-stand-left"></div>
                <div className="rack-stand-right"></div>
                
                {/* Moving Hanger */}
                <div 
                  className="hanger-icon" 
                  style={{left: `calc(10% + ${deletingItem.progress * 0.7}%)`}}
                  key={`hanger-${deletingItem.progress}`}
                >
                  <div className="hanger-hook"></div>
                  <div className="hanger-bar"></div>
                  <div className="hanger-left"></div>
                  <div className="hanger-right"></div>
                  <div className="hanger-clothing"></div>
                </div>
                
                {/* Trashcan at the end */}
                <div className="trashcan-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Switcher */}
        <div className="view-switcher">
          <button 
            className={`view-tab ${viewMode === 'batches' ? 'active' : ''}`}
            onClick={() => setViewMode('batches')}
          >
            <Folder size={18} />
            <span>Batches</span>
          </button>
          <button 
            className={`view-tab ${viewMode === 'groups' ? 'active' : ''}`}
            onClick={() => setViewMode('groups')}
          >
            <Package size={18} />
            <span>Product Groups</span>
          </button>
          <button 
            className={`view-tab ${viewMode === 'images' ? 'active' : ''}`}
            onClick={() => setViewMode('images')}
          >
            <Grid3x3 size={18} />
            <span>Images</span>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="library-filter-bar">
          {/* Batches filters */}
          {viewMode === 'batches' && (
            <>
              <input
                className="filter-search"
                type="text"
                placeholder="Search batches…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <select
                className="filter-select"
                value={filterStep}
                onChange={e => setFilterStep(e.target.value)}
              >
                <option value="">All steps</option>
                <option value="1">Step 1 – Upload</option>
                <option value="2">Step 2 – Group</option>
                <option value="3">Step 3 – Categorize</option>
                <option value="4">Step 4 – Descriptions</option>
                <option value="5">Step 5 – Complete</option>
              </select>
            </>
          )}

          {/* Product Groups filters */}
          {viewMode === 'groups' && (
            <>
              <input
                className="filter-search"
                type="text"
                placeholder="Search groups…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <select
                className="filter-select"
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {groupCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </>
          )}

          {/* Images filters */}
          {viewMode === 'images' && (
            <>
              <select
                className="filter-select"
                value={filterBatchId}
                onChange={e => setFilterBatchId(e.target.value)}
              >
                <option value="">All batches</option>
                {imageBatches.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <select
                className="filter-select"
                value={filterGroupId}
                onChange={e => setFilterGroupId(e.target.value)}
              >
                <option value="">All product groups</option>
                {imageGroups.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              {imageBrands.length > 0 && (
                <select
                  className="filter-select"
                  value={filterBrand}
                  onChange={e => setFilterBrand(e.target.value)}
                >
                  <option value="">All brands</option>
                  {imageBrands.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              )}
              {imageSizes.length > 0 && (
                <select
                  className="filter-select"
                  value={filterSize}
                  onChange={e => setFilterSize(e.target.value)}
                >
                  <option value="">All sizes</option>
                  {imageSizes.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
              {imageConditions.length > 0 && (
                <select
                  className="filter-select"
                  value={filterCondition}
                  onChange={e => setFilterCondition(e.target.value)}
                >
                  <option value="">All conditions</option>
                  {imageConditions.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
              <label className="filter-toggle">
                <input
                  type="checkbox"
                  checked={filterUnassigned}
                  onChange={e => setFilterUnassigned(e.target.checked)}
                />
                Unassigned
              </label>
            </>
          )}

          {/* Active filter count + clear */}
          {(searchQuery || filterStep || filterCategory || filterBatchId || filterGroupId || filterUnassigned || filterBrand || filterSize || filterCondition) && (
            <button
              className="filter-clear"
              onClick={() => {
                setSearchQuery('');
                setFilterStep('');
                setFilterCategory('');
                setFilterBatchId('');
                setFilterGroupId('');
                setFilterUnassigned(false);
                setFilterBrand('');
                setFilterSize('');
                setFilterCondition('');
              }}
            >
              ✕ Clear filters
            </button>
          )}
        </div>

        {/* Selection Toolbar */}
        {selectedItems.size > 0 && (
          <div className="selection-toolbar">
            <div className="selection-info">
              <span className="selection-count">{selectedItems.size} selected</span>
              <button className="toolbar-button" onClick={clearSelection}>
                Clear
              </button>
            </div>
            <div className="selection-actions">
              <button className="toolbar-button" onClick={selectAll}>
                Select All
              </button>
              {viewMode === 'images' && (
                <>
                  <button
                    className="toolbar-button"
                    onClick={() => { setShowAssignModal(true); setShowNewGroupModal(false); }}
                    title="Assign selected images to an existing product group"
                  >
                    <Package size={16} />
                    Assign to Group
                  </button>
                  <button
                    className="toolbar-button"
                    onClick={() => { setShowNewGroupModal(true); setShowAssignModal(false); setNewGroupTitle(''); }}
                    title="Create a new product group from selected images"
                  >
                    <Layers size={16} />
                    New Group from Selected
                  </button>
                </>
              )}
              <button className="toolbar-button danger" onClick={handleBulkDelete}>
                <Trash2 size={16} />
                Delete Selected
              </button>
            </div>
          </div>
        )}

        {/* Assign to Group Modal */}
        {showAssignModal && viewMode === 'images' && (
          <div className="assign-modal-overlay" onClick={() => setShowAssignModal(false)}>
            <div className="assign-modal" onClick={e => e.stopPropagation()}>
              <h3>Assign {selectedItems.size} image{selectedItems.size !== 1 ? 's' : ''} to a Product Group</h3>
              <select
                value={assignTargetGroupId}
                onChange={e => setAssignTargetGroupId(e.target.value)}
                className="assign-select"
              >
                <option value="">— Select a product group —</option>
                {productGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.title} ({g.category})</option>
                ))}
              </select>
              {productGroups.length === 0 && (
                <p className="assign-hint">No product groups found. Switch to Product Groups view first, or use "New Group from Selected".</p>
              )}
              <div className="assign-modal-actions">
                <button className="button button-secondary" onClick={() => setShowAssignModal(false)}>Cancel</button>
                <button
                  className="button button-primary"
                  onClick={handleAssignToGroup}
                  disabled={!assignTargetGroupId || assignWorking}
                >
                  {assignWorking ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* New Group from Selected Modal */}
        {showNewGroupModal && viewMode === 'images' && (
          <div className="assign-modal-overlay" onClick={() => setShowNewGroupModal(false)}>
            <div className="assign-modal" onClick={e => e.stopPropagation()}>
              <h3>Create New Group from {selectedItems.size} image{selectedItems.size !== 1 ? 's' : ''}</h3>
              <label className="assign-label">Group name (optional):</label>
              <input
                type="text"
                className="assign-input"
                value={newGroupTitle}
                onChange={e => setNewGroupTitle(e.target.value)}
                placeholder="e.g. Vintage Levi's Jackets"
                onKeyDown={e => { if (e.key === 'Enter') handleGroupIntoNew(); }}
                autoFocus
              />
              <div className="assign-modal-actions">
                <button className="button button-secondary" onClick={() => setShowNewGroupModal(false)}>Cancel</button>
                <button
                  className="button button-primary"
                  onClick={handleGroupIntoNew}
                  disabled={assignWorking}
                >
                  {assignWorking ? 'Creating…' : 'Create Group'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Batches View */}
        {viewMode === 'batches' && (
          <>
            {filteredBatches.length === 0 ? (
              <div className="empty-state">
                <Folder size={64} className="empty-icon" />
                <p>{batches.length === 0 ? 'No saved batches yet.' : 'No batches match your filters.'}</p>
                <p className="empty-subtitle">{batches.length === 0 ? 'Start a new workflow to create your first batch.' : 'Try adjusting or clearing your filters.'}</p>
              </div>
            ) : (
              <div 
                className="batch-grid"
                ref={batchesGridRef}
                onMouseDown={(e) => handleMouseDown(e, batchesGridRef)}
              >
                {renderBatchesView()}
                {isSelecting && selectionBox && viewMode === 'batches' && (() => {
                  const viewportBox = getViewportSelectionBox();
                  return viewportBox ? (
                    <div
                      className="selection-box"
                      style={{
                        left: `${viewportBox.x}px`,
                        top: `${viewportBox.y}px`,
                        width: `${viewportBox.width}px`,
                        height: `${viewportBox.height}px`,
                      }}
                    />
                  ) : null;
                })()}
              </div>
            )}
          </>
        )}

        {/* Product Groups View */}
        {viewMode === 'groups' && (
          <>
            {filteredGroups.length === 0 ? (
              <div className="empty-state">
                <Package size={64} className="empty-icon" />
                <p>{productGroups.length === 0 ? 'No product groups yet.' : 'No groups match your filters.'}</p>
                <p className="empty-subtitle">{productGroups.length === 0 ? 'Complete Step 2 (Group Images) to create product groups.' : 'Try adjusting or clearing your filters.'}</p>
              </div>
            ) : (
              <div 
                className="groups-grid"
                ref={groupsGridRef}
                onMouseDown={(e) => handleMouseDown(e, groupsGridRef)}
              >
                {renderProductGroupsView()}
                {isSelecting && selectionBox && viewMode === 'groups' && (() => {
                  const viewportBox = getViewportSelectionBox();
                  return viewportBox ? (
                    <div
                      className="selection-box"
                      style={{
                        left: `${viewportBox.x}px`,
                        top: `${viewportBox.y}px`,
                        width: `${viewportBox.width}px`,
                        height: `${viewportBox.height}px`,
                      }}
                    />
                  ) : null;
                })()}
              </div>
            )}
          </>
        )}

        {/* Images View */}
        {viewMode === 'images' && (
          <>
            {filteredImages.length === 0 ? (
              <div className="empty-state">
                <Image size={64} className="empty-icon" />
                <p>{images.length === 0 ? 'No images yet.' : 'No images match your filters.'}</p>
                <p className="empty-subtitle">{images.length === 0 ? 'Upload images in Step 1 to see them here.' : 'Try adjusting or clearing your filters.'}</p>
              </div>
            ) : (
              <div 
                className="images-grid"
                ref={imagesGridRef}
                onMouseDown={(e) => handleMouseDown(e, imagesGridRef)}
              >
                {renderImagesView()}
                {isSelecting && selectionBox && viewMode === 'images' && (() => {
                  const viewportBox = getViewportSelectionBox();
                  return viewportBox ? (
                    <div
                      className="selection-box"
                      style={{
                        left: `${viewportBox.x}px`,
                        top: `${viewportBox.y}px`,
                        width: `${viewportBox.width}px`,
                        height: `${viewportBox.height}px`,
                      }}
                    />
                  ) : null;
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // Render Batches View
  function renderBatchesView() {
    return filteredBatches.map((batch) => {
      const thumbnails = getThumbnails(batch);
      const progress = getStepProgress(batch);
      const isSelected = selectedItems.has(batch.id);
      const isDragging = draggedItem === batch.id;
      const isDragOver = dragOverItem === batch.id;
      
      return (
        <div 
          key={batch.id}
          data-item-id={batch.id}
          className={`batch-card ${batch.is_completed ? 'completed' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
          onClick={(e) => {
            // Only prevent selection if directly clicking buttons or inputs
            const target = e.target as HTMLElement;
            if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('button')) {
              return;
            }
            handleItemClick(batch.id, e);
          }}
          draggable
          onDragStart={(e) => handleDragStart(batch.id, e)}
          onDragOver={(e) => handleDragOver(batch.id, e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(batch.id, e)}
          onDragEnd={handleDragEnd}
        >
          {/* Selection Indicator - Matches ImageGrouper style */}
          {isSelected && (
            <div className="selection-indicator">
              <Check size={20} />
            </div>
          )}

          {/* Thumbnail Grid (2x2) */}
          <div className="batch-thumbnails">
            {thumbnails.length > 0 ? (
              <div className={`thumbnail-grid grid-${Math.min(thumbnails.length, 4)}`}>
                {thumbnails.map((url, idx) => (
                  <div key={idx} className="thumbnail-item">
                    <img src={url} alt={`Product ${idx + 1}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="thumbnail-placeholder">
                <Image size={48} />
                <p>No images</p>
              </div>
            )}
          </div>

          {/* Batch Info */}
          <div className="batch-info">
            <div className="batch-title">
              <Folder size={16} className="folder-icon" />
              {editingBatch === batch.id ? (
                <input
                  type="text"
                  className="batch-name-input"
                  value={editBatchName}
                  onChange={(e) => setEditBatchName(e.target.value)}
                  onBlur={() => handleEditBatchName(batch.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditBatchName(batch.id);
                    if (e.key === 'Escape') {
                      setEditingBatch(null);
                      setEditBatchName('');
                    }
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <h3 onClick={(e) => {
                  e.stopPropagation();
                  setEditingBatch(batch.id);
                  const defaultName = `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  setEditBatchName(batch.batch_name || defaultName);
                }}>
                  {batch.batch_name || `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </h3>
              )}
              <button
                className="edit-icon-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingBatch(batch.id);
                  const defaultName = `Batch ${new Date(batch.created_at).toLocaleDateString()} ${new Date(batch.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  setEditBatchName(batch.batch_name || defaultName);
                }}
                title="Edit batch name"
              >
                <Edit2 size={14} />
              </button>
            </div>

            <div className="batch-meta">
              <div className="meta-row">
                <Calendar size={14} />
                <span>{formatDate(batch.updated_at)}</span>
              </div>
              <div className="meta-row">
                <Image size={14} />
                <span>{batch.total_images} {batch.total_images === 1 ? 'image' : 'images'}</span>
              </div>
              <div className="meta-row">
                <Layers size={14} />
                <span>{batch.product_groups_count} {batch.product_groups_count === 1 ? 'group' : 'groups'}</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="batch-progress">
              <div className="progress-label">
                <span className="step-label">Step {batch.current_step}: {getStepLabel(batch.current_step)}</span>
                <span className="progress-percent">{Math.round(progress)}%</span>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Status Badge */}
            {batch.is_completed && (
              <div className="status-badge completed">
                <Tag size={12} />
                <span>Completed</span>
              </div>
            )}
          </div>

          {/* Hover Actions */}
          <div className="batch-actions">
            <button 
              className="action-button secondary"
              onClick={(e) => {
                e.stopPropagation();
                handleDuplicateBatch(batch.id);
              }}
              title="Duplicate batch"
            >
              <Copy size={16} />
              <span>Duplicate</span>
            </button>
            <button 
              className="action-button primary"
              onClick={(e) => {
                e.stopPropagation();
                onOpenBatch(batch);
              }}
              title="Open batch"
            >
              <ArrowRight size={16} />
              <span>Open</span>
            </button>
            <button 
              className="action-button danger"
              onClick={(e) => {
                e.stopPropagation();
                if (deleteConfirm === batch.id) {
                  handleDelete(batch.id);
                } else {
                  setDeleteConfirm(batch.id);
                  setTimeout(() => setDeleteConfirm(null), 3000);
                }
              }}
              title={deleteConfirm === batch.id ? 'Click again to confirm' : 'Delete batch'}
            >
              <Trash2 size={16} />
              <span>{deleteConfirm === batch.id ? 'Confirm?' : 'Delete'}</span>
            </button>
          </div>
        </div>
      );
    });
  }

  // Render Product Groups View
  function renderProductGroupsView() {
    return filteredGroups.map((group) => {
      const isSelected = selectedItems.has(group.id);
      const isDragging = draggedItem === group.id;
      const isDragOver = dragOverItem === group.id;
      
      return (
        <div 
          key={group.id}
          data-item-id={group.id}
          className={`group-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
          onClick={(e) => {
            // Only prevent selection if directly clicking buttons
            const target = e.target as HTMLElement;
            if (target.tagName === 'BUTTON' || target.closest('button')) {
              return;
            }
            handleItemClick(group.id, e);
          }}
          draggable
          onDragStart={(e) => handleDragStart(group.id, e)}
          onDragOver={(e) => handleDragOver(group.id, e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(group.id, e)}
          onDragEnd={handleDragEnd}
        >
          {/* Selection Indicator - Matches ImageGrouper style */}
          {isSelected && (
            <div className="selection-indicator">
              <Check size={20} />
            </div>
          )}

          {/* Group Images */}
          <div className="group-images">
            {group.images.length > 0 ? (
              <div className={`thumbnail-grid grid-${Math.min(group.images.length, 4)}`}>
                {group.images.slice(0, 4).map((url, idx) => (
                  <div key={idx} className="thumbnail-item">
                    <img src={url} alt={`${group.title} ${idx + 1}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="thumbnail-placeholder">
                <Package size={48} />
                <p>No images</p>
              </div>
            )}
          </div>

          {/* Group Info */}
          <div className="group-info">
            <h3>{group.title}</h3>
            <div className="group-meta">
              <div className="meta-tag category">
                <Tag size={12} />
                <span>{group.category}</span>
              </div>
              <div className="meta-tag">
                <Image size={12} />
                <span>{group.itemCount} {group.itemCount === 1 ? 'image' : 'images'}</span>
              </div>
              <div className="meta-tag">
                <Calendar size={12} />
                <span>{formatDate(group.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* Group Actions */}
          <div className="group-actions">
            <button 
              className="action-button danger"
              onClick={(e) => {
                e.stopPropagation();
                if (deleteConfirm === group.id) {
                  handleDeleteGroup(group.id);
                } else {
                  setDeleteConfirm(group.id);
                  setTimeout(() => setDeleteConfirm(null), 3000);
                }
              }}
              title={deleteConfirm === group.id ? 'Click again to confirm' : 'Delete group'}
            >
              <Trash2 size={14} />
              <span>{deleteConfirm === group.id ? 'Confirm?' : 'Delete'}</span>
            </button>
          </div>
        </div>
      );
    });
  }

  // Render Images View
  function renderImagesView() {
    return filteredImages.map((image) => {
      const isSelected = selectedItems.has(image.id);
      const isDragging = draggedItem === image.id;
      const isDragOver = dragOverItem === image.id;
      
      return (
        <div 
          key={image.id}
          data-item-id={image.id}
          className={`image-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
          onClick={(e) => {
            // Only prevent selection if directly clicking buttons
            const target = e.target as HTMLElement;
            if (target.tagName === 'BUTTON' || target.closest('button')) {
              return;
            }
            handleItemClick(image.id, e);
          }}
          draggable
          onDragStart={(e) => handleDragStart(image.id, e)}
          onDragOver={(e) => handleDragOver(image.id, e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(image.id, e)}
          onDragEnd={handleDragEnd}
        >
          {/* Selection Indicator - Matches ImageGrouper style */}
          {isSelected && (
            <div className="selection-indicator">
              <Check size={20} />
            </div>
          )}

          <div className="image-preview">
            {image.preview ? (
              <img src={image.preview} alt="Product" />
            ) : (
              <div className="image-placeholder">
                <Image size={32} />
              </div>
            )}
          </div>
          
          <div className="image-info">
            <div className="image-meta">
              {image.category && (
                <div className="meta-tag category">
                  <Tag size={10} />
                  <span>{image.category}</span>
                </div>
              )}
              {image.batchNumber && (
                <div className="meta-tag">
                  <Folder size={10} />
                  <span>#{image.batchNumber.slice(0, 6)}</span>
                </div>
              )}
              {!image.productGroup && (
                <div className="meta-tag loose-badge" title="Not assigned to any product group">
                  <span>Loose</span>
                </div>
              )}
            </div>
            
            <button 
              className="image-delete"
              onClick={(e) => {
                e.stopPropagation();
                if (deleteConfirm === image.id) {
                  // Find the storage path for this image
                  const storagePath = images.find(img => img.id === image.id)?.preview?.includes('supabase')
                    ? images.find(img => img.id === image.id)?.preview
                    : undefined;
                  handleDeleteImage(image.id, storagePath);
                } else {
                  setDeleteConfirm(image.id);
                  setTimeout(() => setDeleteConfirm(null), 3000);
                }
              }}
              title={deleteConfirm === image.id ? 'Click again to confirm' : 'Delete image'}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      );
    });
  }
};
