import { useState, useRef, useEffect, useMemo } from 'react';
import type { ClothingItem } from '../App';
import { Target } from 'lucide-react';
import { ComprehensiveProductForm } from './ComprehensiveProductForm';
import { getCategoryPresets } from '../lib/categoryPresetsService';
import type { CategoryPreset } from '../lib/categoryPresets';
import { applyPresetToProductGroup } from '../lib/applyPresetToGroup';
import { generateProductDescription, stripVoiceCommands, formatVoiceTranscript } from '../lib/textAIService';
import { syncGroupFieldsToDatabase } from '../lib/productService';
import LazyImg from './LazyImg';
import './ProductDescriptionGenerator.css';

interface ProductDescriptionGeneratorProps {
  items: ClothingItem[];
  onProcessed: (items: ClothingItem[]) => void;
  onDownloadCSV?: () => void;
  batchId?: string | null;
}

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

const ProductDescriptionGenerator: React.FC<ProductDescriptionGeneratorProps> = ({ 
  items, 
  onProcessed,
  onDownloadCSV,
  batchId,
}) => {
  const [processedItems, setProcessedItems] = useState<ClothingItem[]>(items);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [availablePresets, setAvailablePresets] = useState<CategoryPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(false);

  // Photo reorder drag state (Step 4 thumbnails)
  const [draggedThumbId, setDraggedThumbId] = useState<string | null>(null);
  const [dragOverThumbId, setDragOverThumbId] = useState<string | null>(null);

  // Lightbox state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Magnifier state — cursor-following zoom lens on main preview image
  const [magnifier, setMagnifier] = useState<{ src: string; x: number; y: number; bgX: number; bgY: number } | null>(null);
  const mainPreviewRef = useRef<HTMLDivElement | null>(null);

  const recognitionRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const isStartingRef = useRef(false);
  const lastClickTimeRef = useRef(0);
  const buttonStateTransitionRef = useRef(0);
  const hasMountedRef = useRef(false); // Track if component has mounted
  const previousItemsLengthRef = useRef(0); // Track items array length for batch changes
  const previousBatchIdRef = useRef<string | null | undefined>(undefined); // Track batchId for batch switches
  const previousItemsRefRef = useRef<ClothingItem[]>([]); // Track items reference for any-change detection
  const isResettingRef = useRef(false); // Track when we're mid-reset to suppress sync-back
  // Always-current snapshot of processedItems so async handlers (handleStopRecording)
  // aren't trapped by stale closure state from before the last onresult update.
  const processedItemsRef = useRef<ClothingItem[]>(processedItems);
  useEffect(() => { processedItemsRef.current = processedItems; }, [processedItems]);

  // Memoize group calculation to avoid unnecessary recalculations
  const { groupArray, currentGroup, currentItem } = useMemo(() => {
    const productGroups = processedItems.reduce((groups, item) => {
      const groupId = item.productGroup || item.id;
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(item);
      return groups;
    }, {} as Record<string, ClothingItem[]>);
    
    const groupArray = Object.values(productGroups);
    const currentGroup = groupArray[currentGroupIndex] || [];
    const currentItem = currentGroup[0];
    
    return { groupArray, currentGroup, currentItem };
  }, [processedItems, currentGroupIndex]);  // Auto-sync processedItems back to parent for auto-save
  // Skip on initial mount to avoid overwriting loaded descriptions
  useEffect(() => {
    if (!hasMountedRef.current) {
      // First render - just mark as mounted, don't sync
      hasMountedRef.current = true;
      return;
    }
    // Skip sync-back when we just reset from incoming props (avoids writing stale data back up)
    if (isResettingRef.current) {
      isResettingRef.current = false;
      return;
    }
    // Don't write back if internal state is out of sync with the prop —
    // the sync effect (below) hasn't run yet and will correct it next render.
    if (processedItems.length !== items.length) return;
    
    // Subsequent updates - sync to parent
    onProcessed(processedItems);
  // onProcessed intentionally omitted — it's a stable callback from the parent and
  // including it causes this effect to re-fire on every App render (new function reference).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedItems]);

  // Mark unsaved changes whenever processedItems mutates after mount
  useEffect(() => {
    if (!hasMountedRef.current) return;
    if (isResettingRef.current) return;
    setHasUnsavedChanges(true);
    setSaveConfirmed(false);
  }, [processedItems]);

  // Update local state when items prop changes (e.g., opening a different batch)
  // Reset whenever batchId changes, or items array reference/length/content changes
  useEffect(() => {
    const batchChanged = batchId !== previousBatchIdRef.current;
    const lengthChanged = items.length !== previousItemsLengthRef.current;
    // Also detect same-length but different content (e.g. re-group same number of items)
    const firstIdChanged = items[0]?.id !== previousItemsRefRef.current[0]?.id;

    if (batchChanged || lengthChanged || firstIdChanged) {
      console.log(`[Step4:PDG] prop sync | items: ${previousItemsLengthRef.current} → ${items.length} | batchChanged=${batchChanged} lengthChanged=${lengthChanged} firstIdChanged=${firstIdChanged}`);
      isResettingRef.current = true;
      setProcessedItems(items);
      setCurrentGroupIndex(0); // Reset to first group
      previousItemsLengthRef.current = items.length;
      previousBatchIdRef.current = batchId;
      previousItemsRefRef.current = items;
    }
  }, [items, batchId]);

  useEffect(() => {
    // Check if browser supports Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      console.warn('Speech Recognition not supported in this browser. Use Chrome or Edge.');
      return;
    }

    // Initialize Speech Recognition
    const recognition = new SpeechRecognition();
    recognition.continuous = true; // Changed back to true for continuous listening
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsRecording(true);
      isRecordingRef.current = true;
      isStartingRef.current = false;
      
      // Mark when button transitions to Stop state
      buttonStateTransitionRef.current = Date.now();
      
      // Enable button after 1000ms delay (increased from 700ms)
      setTimeout(() => {
        setIsTransitioning(false);
      }, 1000);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      // Correct common speech-to-text misrecognitions for clothing measurements
      const fixTranscript = (t: string) =>
        t
          .replace(/\bwith\b(?=\s+\d)/gi, 'width')   // "with 18 inches" → "width 18 inches"
          .replace(/\bwidth\b(?=\s+(a|an|the)\b)/gi, 'with') // "width a great" → "with a great"
          .replace(/\bwidth\b(?=\s+[a-z]{3,}(?!\s*\d))/gi, 'with'); // "width nice" → "with nice"

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = fixTranscript(event.results[i][0].transcript);
        if (event.results[i].isFinal) {
          final += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      if (final) {
        setProcessedItems(prev => {
          const updated = [...prev];
          
          // Recalculate groups from updated items
          const updatedGroups = updated.reduce((groups, item) => {
            const groupId = item.productGroup || item.id;
            if (!groups[groupId]) {
              groups[groupId] = [];
            }
            groups[groupId].push(item);
            return groups;
          }, {} as Record<string, ClothingItem[]>);
          
          const updatedGroupArray = Object.values(updatedGroups);
          const currentGroup = updatedGroupArray[currentGroupIndex];
          const currentItem = currentGroup[0];
          const currentDescription = currentItem.voiceDescription || '';
          
          // Apply voice description to all items in the current group
          currentGroup.forEach(groupItem => {
            const itemIndex = updated.findIndex(item => item.id === groupItem.id);
            if (itemIndex !== -1) {
              updated[itemIndex] = {
                ...updated[itemIndex],
                voiceDescription: (currentDescription + final).trim()
              };
            }
          });
          
          return updated;
        });
        
        setInterimTranscript('');
        
        // Don't restart automatically - continuous mode handles this
      } else {
        setInterimTranscript(interim);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Ignore aborted errors (expected during stop/cleanup)
      if (event.error === 'aborted') {
        return;
      }
      
      // For no-speech, just continue (continuous mode will handle it)
      if (event.error === 'no-speech') {
        return;
      }
      
      // For real errors, stop recording
      setIsRecording(false);
      isRecordingRef.current = false;
      isStartingRef.current = false;
      setInterimTranscript('');
      
      let errorMessage = 'Speech recognition error: ';
      switch (event.error) {
        case 'audio-capture':
          errorMessage += 'No microphone found or access denied.';
          break;
        case 'not-allowed':
          errorMessage += 'Microphone access denied. Please allow microphone access.';
          break;
        case 'network':
          errorMessage += 'Network error. Please check your connection.';
          break;
        default:
          errorMessage += event.error;
      }
      alert(errorMessage);
    };

    recognition.onend = () => {
      // Only restart if we're still supposed to be recording
      // This happens when continuous mode times out or browser limits it
      if (isRecordingRef.current && !isStartingRef.current) {
        isStartingRef.current = true;
        
        setTimeout(() => {
          if (isRecordingRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (err) {
              setIsRecording(false);
              isRecordingRef.current = false;
              isStartingRef.current = false;
            }
          } else {
            isStartingRef.current = false;
          }
        }, 300);
      } else {
        setIsRecording(false);
        setInterimTranscript('');
        isStartingRef.current = false;
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          isRecordingRef.current = false;
          isStartingRef.current = false;
          recognitionRef.current.abort();
        } catch (err) {
          // Cleanup error - ignore
        }
      }
    };
  }, [currentGroupIndex]);

  // Load available presets on mount
  useEffect(() => {
    const loadPresets = async () => {
      try {
        const presets = await getCategoryPresets();
        setAvailablePresets(presets.filter(p => p.is_active));
      } catch (error) {
        // Silently fail preset loading
      }
    };
    loadPresets();
  }, []);

  // Apply presets to ALL groups on initial load (batch processing)
  useEffect(() => {
    const applyPresetsToAllGroups = async () => {
      if (availablePresets.length === 0) return;
      
      // Group items by productGroup
      const productGroups = processedItems.reduce((groups, item) => {
        const groupId = item.productGroup || item.id;
        if (!groups[groupId]) {
          groups[groupId] = [];
        }
        groups[groupId].push(item);
        return groups;
      }, {} as Record<string, ClothingItem[]>);

      let hasChanges = false;
      const updatedItems = [...processedItems];

      // Apply presets to each group that has a category but no preset data
      for (const [, groupItems] of Object.entries(productGroups)) {
        const firstItem = groupItems[0];
        
        // Skip if no category assigned
        if (!firstItem.category) continue;
        
        // Check if preset is already applied for this category
        const hasPresetData = groupItems.some(item => item._presetData);
        const presetCategory = groupItems.find(item => item._presetData)?._presetData?.productType;
        const isSameCategory = presetCategory?.toLowerCase() === firstItem.category?.toLowerCase();
        const hasPresetFields = groupItems.some(item => 
          item.policies || item.shipsFrom || item.gender || item.whoMadeIt
        );
        
        // Skip if preset already applied for this category
        if (hasPresetData && hasPresetFields && isSameCategory) continue;

        try {
          // Apply preset to this group
          const updatedGroup = await applyPresetToProductGroup(groupItems, firstItem.category);
          
          // Update items in the array
          updatedGroup.forEach((updatedItem) => {
            const itemIndex = updatedItems.findIndex(item => item.id === updatedItem.id);
            if (itemIndex !== -1) {
              updatedItems[itemIndex] = updatedItem;
              hasChanges = true;
            }
          });
        } catch (error) {
          // Silently fail for this group, continue with others
        }
      }

      // Only update state if there were actual changes
      if (hasChanges) {
        setProcessedItems(updatedItems);
      }
    };

    applyPresetsToAllGroups();
  }, [availablePresets]); // Run when presets load

  // Auto-apply default preset when current group changes OR when category changes
  useEffect(() => {
    const autoApplyDefaultPreset = async () => {
      if (!currentItem || !currentItem.category) {
        return;
      }
      
      // Check if the preset is already applied for THIS category
      // Compare the category stored in _presetData with the current category
      const hasPresetData = currentGroup.some(item => item._presetData);
      const presetCategory = currentGroup.find(item => item._presetData)?._presetData?.productType;
      const isSameCategory = presetCategory?.toLowerCase() === currentItem.category?.toLowerCase();
      
      // Check if key fields are actually filled
      const hasPresetFields = currentGroup.some(item => 
        item.policies || 
        item.shipsFrom || 
        item.gender || 
        item.whoMadeIt
      );
      
      // Only skip if preset exists, fields are filled, AND it's the same category
      if (hasPresetData && hasPresetFields && isSameCategory) {
        return;
      }

      try {
        const updatedGroup = await applyPresetToProductGroup(currentGroup, currentItem.category);
        
        // Update processedItems with preset-enriched items
        const updated = [...processedItems];
        updatedGroup.forEach((updatedItem) => {
          const itemIndex = updated.findIndex(item => item.id === updatedItem.id);
          if (itemIndex !== -1) {
            updated[itemIndex] = updatedItem;
          }
        });
        
        setProcessedItems(updated);
        
        // Find and set the default preset ID in the dropdown
        const defaultPreset = availablePresets.find(p => 
          (p.product_type?.toLowerCase() === currentItem.category?.toLowerCase() || 
           p.category_name.toLowerCase() === currentItem.category?.toLowerCase()) &&
          p.is_default && 
          p.is_active
        );
        
        if (defaultPreset) {
          setSelectedPresetId(defaultPreset.id);
        }
      } catch (error) {
        // Silently fail auto-apply
      }
    };

    if (availablePresets.length > 0) {
      autoApplyDefaultPreset();
    }
  }, [currentGroupIndex, currentItem?.category, availablePresets]); // Watch category changes too!

  // Apply manual preset override
  const handleApplyPreset = async (presetId: string) => {
    if (!presetId) return;
    console.log(`[Step4:PDG] applyPreset | presetId=${presetId} | groupIndex=${currentGroupIndex}`);
    
    try {
      const preset = availablePresets.find(p => p.id === presetId);
      if (!preset) return;

      // Determine which groups to apply to: selected set OR just current group
      const targetGroupLeaderIds = selectedGroupIds.size > 0
        ? selectedGroupIds
        : new Set([currentItem.productGroup || currentItem.id]);

      // Collect all items belonging to those groups
      const groupsToUpdate = groupArray.filter(g => {
        const leaderId = g[0].productGroup || g[0].id;
        return targetGroupLeaderIds.has(leaderId);
      });

      const allUpdatedItems: ClothingItem[] = [];
      for (const group of groupsToUpdate) {
        const updatedGroup = await applyPresetToProductGroup(group, preset.product_type || preset.category_name);
        allUpdatedItems.push(...updatedGroup);
      }

      setProcessedItems(prev => {
        const updated = [...prev];
        allUpdatedItems.forEach((updatedItem) => {
          const idx = updated.findIndex(item => item.id === updatedItem.id);
          if (idx !== -1) updated[idx] = updatedItem;
        });
        return updated;
      });
      setSelectedPresetId(presetId);
      // Clear selection after applying
      if (selectedGroupIds.size > 0) setSelectedGroupIds(new Set());
    } catch (error) {
      alert('Failed to apply preset. Please try again.');
    }
  };

  const handleStartRecording = () => {
    console.log(`[Step4:PDG] startRecording | groupIndex=${currentGroupIndex} item=${currentItem?.id}`);
    if (isTransitioning) {
      return;
    }
    
    // Prevent rapid clicks
    const now = Date.now();
    if (now - lastClickTimeRef.current < 1000) {
      return;
    }
    lastClickTimeRef.current = now;
    
    if (!speechSupported) {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    if (!recognitionRef.current) {
      alert('Speech recognition not initialized. Please refresh the page.');
      return;
    }

    if (isStartingRef.current || isRecordingRef.current) {
      return;
    }
    
    setIsTransitioning(true);
    isRecordingRef.current = true;
    isStartingRef.current = true;
    
    try {
      recognitionRef.current.start();
    } catch (error) {
      isRecordingRef.current = false;
      isStartingRef.current = false;
      setIsTransitioning(false);
      alert('Could not start speech recognition. Make sure microphone access is allowed.');
    }
  };

  const handleStopRecording = async () => {
    console.log(`[Step4:PDG] stopRecording | groupIndex=${currentGroupIndex} | voiceDesc="${currentItem?.voiceDescription?.slice(0, 60)}…"`);
    if (isTransitioning) {
      return;
    }
    
    // Prevent clicks within 1000ms of button state transition (increased from 500ms)
    const timeSinceTransition = Date.now() - buttonStateTransitionRef.current;
    if (timeSinceTransition < 1000) {
      return;
    }
    
    // Prevent rapid clicks
    const now = Date.now();
    if (now - lastClickTimeRef.current < 500) {
      return;
    }
    lastClickTimeRef.current = now;
    
    if (!isRecordingRef.current) {
      return;
    }
    
    isRecordingRef.current = false;
    isStartingRef.current = false;
    setIsRecording(false);
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        // Ignore stop errors
      }
    }
    setInterimTranscript('');

    // AUTO-EXTRACT FIELDS FROM VOICE DESCRIPTION WHEN RECORDING STOPS
    // Read from the ref for a best-effort snapshot to build the AI request.
    // The actual state write uses setProcessedItems(prev=>) so it always
    // merges into the true latest state regardless of render timing.
    const latestItems = processedItemsRef.current;
    const latestGroups = latestItems.reduce((groups, item) => {
      const groupId = item.productGroup || item.id;
      if (!groups[groupId]) groups[groupId] = [];
      groups[groupId].push(item);
      return groups;
    }, {} as Record<string, ClothingItem[]>);
    const latestGroupArray = Object.values(latestGroups);
    const latestGroup = latestGroupArray[currentGroupIndex] || [];
    const latestItem = latestGroup[0];

    // Capture target IDs now — before any async gap
    const targetIds = new Set(latestGroup.map(g => g.id));

    if (latestItem?.voiceDescription) {
      try {
        setIsGenerating(true);
        
        // Use AI to extract fields from voice description
        const aiResult = await generateProductDescription({
          voiceDescription: latestItem.voiceDescription,
          brand: latestItem.brand,
          color: latestItem.color,
          size: latestItem.size,
          material: latestItem.material,
          condition: latestItem.condition as any,
          era: latestItem.era,
          style: latestItem.style,
          category: latestItem.productType,
          measurements: latestItem.measurements,
          flaws: latestItem.flaws,
          care: latestItem.care
        });

        // Extract fields from AI result (only fields with supporting info)
        const extractedFields = aiResult.extractedFields || {};
        
        // Use functional update so we always write into the true latest state —
        // not the stale ref snapshot that was captured before the await resolved.
        // voiceDescription is intentionally LEFT AS-IS — the textarea always shows
        // the full formatted transcript (field commands + any prose) so the user
        // can review everything that was spoken. Strip only happens at AI call sites.
        setProcessedItems(prev => {
          const updated = [...prev];
          updated.forEach((item, idx) => {
            if (!targetIds.has(item.id)) return;
            updated[idx] = {
              ...item,
              ...(extractedFields.brand && { brand: extractedFields.brand }),
              ...(extractedFields.modelName && { modelName: extractedFields.modelName }),
              ...(extractedFields.color && { color: extractedFields.color }),
              ...(extractedFields.secondaryColor && { secondaryColor: extractedFields.secondaryColor }),
              ...(extractedFields.size && { size: extractedFields.size }),
              ...(extractedFields.material && { material: extractedFields.material }),
              ...(extractedFields.condition && { condition: extractedFields.condition as 'New' | 'Used' | 'NWT' | 'Excellent' | 'Good' | 'Fair' }),
              ...(extractedFields.era && { era: extractedFields.era }),
              ...(extractedFields.style && { style: extractedFields.style }),
              ...(extractedFields.gender && { gender: extractedFields.gender as 'Men' | 'Women' | 'Unisex' | 'Kids' }),
              ...(extractedFields.measurements && { measurements: extractedFields.measurements }),
              ...(extractedFields.price && { price: parseFloat(extractedFields.price) || undefined }),
              ...(extractedFields.flaws && { flaws: extractedFields.flaws }),
              ...(extractedFields.care && { care: extractedFields.care }),
              ...(extractedFields.tags && extractedFields.tags.length > 0 && {
                tags: [...new Set([...(item.tags || []), ...extractedFields.tags])].slice(0, 5)
              }),
            };
          });
          return updated;
        });
        
      } catch (error) {
        console.error('Error extracting fields from voice:', error);
      } finally {
        setIsGenerating(false);
      }
    }
  };

  // Explicit save — pushes all current field values to Supabase immediately.
  // This takes priority over any stale data that might be loaded later.
  const handleSave = async () => {
    console.log(`[Step4:PDG] save | groupIndex=${currentGroupIndex} | totalItems=${processedItems.length} | batchId=${batchId}`);
    if (isSaving) return;
    setIsSaving(true);
    try {
      // Group items by productGroup
      const groups: Record<string, ClothingItem[]> = {};
      processedItems.forEach(item => {
        const gid = item.productGroup || item.id;
        if (!groups[gid]) groups[gid] = [];
        groups[gid].push(item);
      });
      // Sync every group to Supabase in parallel
      await Promise.all(
        Object.values(groups).map(groupItems =>
          syncGroupFieldsToDatabase(groupItems, batchId ?? null)
        )
      );
      // Also trigger the parent auto-save so workflow_state blob is updated too
      onProcessed(processedItems);
      setHasUnsavedChanges(false);
      setSaveConfirmed(true);
      // Clear the "Saved ✓" indicator after 3 seconds
      setTimeout(() => setSaveConfirmed(false), 3000);
    } catch {
      // Silently fail — user can try again
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearTranscript = () => {
    console.log(`[Step4:PDG] clearTranscript | groupIndex=${currentGroupIndex}`);
    const updated = [...processedItems];
    
    // Clear voice description for all items in the current group
    currentGroup.forEach(groupItem => {
      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
      if (itemIndex !== -1) {
        updated[itemIndex] = {
          ...updated[itemIndex],
          voiceDescription: ''
        };
      }
    });
    
    setProcessedItems(updated);
    setInterimTranscript('');
  };

  // Banned phrases to filter from AI descriptions

  // Filter function to remove banned phrases

  // Sync structured fields from the edited description text
  const [isSyncingFields, setIsSyncingFields] = useState(false);
  const syncFieldsFromDescription = async () => {
    const descText = currentItem.generatedDescription;
    if (!descText) {
      alert('No description to parse. Generate or type a description first.');
      return;
    }
    setIsSyncingFields(true);
    try {
      const aiResult = await generateProductDescription({
        voiceDescription: descText,
        brand: currentItem.brand,
        color: currentItem.color,
        size: currentItem.size,
        material: currentItem.material,
        condition: currentItem.condition as any,
        era: currentItem.era,
        style: currentItem.style,
        category: currentItem.productType,
        measurements: currentItem.measurements,
        flaws: currentItem.flaws,
        care: currentItem.care,
      });
      const extractedFields = aiResult.extractedFields || {};
      const updated = [...processedItems];
      currentGroup.forEach(groupItem => {
        const itemIndex = updated.findIndex(item => item.id === groupItem.id);
        if (itemIndex !== -1) {
          updated[itemIndex] = {
            ...updated[itemIndex],
            ...(extractedFields.brand && { brand: extractedFields.brand }),
            ...(extractedFields.modelName && { modelName: extractedFields.modelName }),
            ...(extractedFields.color && { color: extractedFields.color }),
            ...(extractedFields.secondaryColor && { secondaryColor: extractedFields.secondaryColor }),
            ...(extractedFields.size && { size: extractedFields.size }),
            ...(extractedFields.material && { material: extractedFields.material }),
            ...(extractedFields.condition && { condition: extractedFields.condition as 'New' | 'Used' | 'NWT' | 'Excellent' | 'Good' | 'Fair' }),
            ...(extractedFields.era && { era: extractedFields.era }),
            ...(extractedFields.style && { style: extractedFields.style }),
            ...(extractedFields.gender && { gender: extractedFields.gender as 'Men' | 'Women' | 'Unisex' | 'Kids' }),
            ...(extractedFields.measurements && { measurements: extractedFields.measurements }),
            ...(extractedFields.price && { price: parseFloat(extractedFields.price) || undefined }),
            ...(extractedFields.flaws && { flaws: extractedFields.flaws }),
            ...(extractedFields.care && { care: extractedFields.care }),
            ...(extractedFields.tags && extractedFields.tags.length > 0 && {
              tags: [...new Set([...(updated[itemIndex].tags || []), ...extractedFields.tags])].slice(0, 5)
            }),
          };
        }
      });
      setProcessedItems(updated);
      alert('✅ Fields updated from description!');
    } catch (err) {
      console.error('Field sync failed:', err);
      alert('Failed to parse fields from description.');
    } finally {
      setIsSyncingFields(false);
    }
  };

  // Individual regenerate functions
  const regenerateDescription = async () => {
    const hasAnyData = !!(currentItem.voiceDescription || currentItem.file ||
      currentItem.brand || currentItem.color || currentItem.size ||
      currentItem.material || currentItem.condition || currentItem.productType);
    if (!hasAnyData) {
      alert('Please add a voice description or image first');
      return;
    }
    
    setIsGenerating(true);
    
    try {
      // Check AI provider - force Google Vision if Llama is selected (Hugging Face API deprecated)
      const savedProvider = localStorage.getItem('ai_provider') as 'google-vision' | 'llama-vision' | null;
      const aiProvider = savedProvider === 'llama-vision' ? 'google-vision' : (savedProvider || 'google-vision');
      
      // Run the real AI generator if we have an image file OR any populated fields.
      // (File objects are lost on page reload/restore, but extracted fields persist.)
      const hasFields = !!(currentItem.brand || currentItem.color || currentItem.size ||
        currentItem.material || currentItem.condition || currentItem.era ||
        currentItem.style || currentItem.productType);
      if (aiProvider === 'google-vision' && (currentItem.file || hasFields)) {
        // Use intelligent template system (Hugging Face is down)
        
        // Build context from everything we know
        const aiResult = await generateProductDescription({
          voiceDescription: stripVoiceCommands(currentItem.voiceDescription || ''),
          brand: currentItem.brand,
          color: currentItem.color,
          size: currentItem.size,
          material: currentItem.material,
          condition: currentItem.condition as any,
          era: currentItem.era,
          style: currentItem.style,
          category: currentItem.productType,
          measurements: currentItem.measurements,
          flaws: currentItem.flaws, // NEW: Include flaws in description
          care: currentItem.care // NEW: Include care instructions
        });
        
        // Use generated description
        const finalDescription = aiResult.description;
        
        // Capture the target item IDs before any async-caused state drift.
        // Use functional update so we always write into the latest processedItems
        // rather than the stale closure snapshot.
        const targetIds = new Set(currentGroup.map(g => g.id));
        setProcessedItems(prev => {
          const updated = [...prev];
          updated.forEach((item, idx) => {
            if (targetIds.has(item.id)) {
              updated[idx] = { ...updated[idx], generatedDescription: finalDescription };
            }
          });
          return updated;
        });
        setIsGenerating(false);
        return;
      }
    } catch (error) {
      console.error('AI generation failed:', error);
      alert(`AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please check that the proxy server is running.`);
      setIsGenerating(false);
      return;
    }
    
    // Fallback: Use basic generation if Llama 3 not enabled
    const voiceDesc = stripVoiceCommands(currentItem.voiceDescription || '');
    const lowerDesc = voiceDesc.toLowerCase();
    
    // Detect colors and materials
    const colorPatterns = {
      black: /black/i,
      white: /white|cream|ivory|off-white/i,
      red: /red|crimson|burgundy|maroon/i,
      blue: /blue|navy|cobalt|azure/i,
      green: /green|olive|forest|emerald/i,
      yellow: /yellow|gold|mustard/i,
      pink: /pink|rose|blush/i,
      purple: /purple|violet|lavender/i,
      gray: /gray|grey|charcoal|slate/i,
      brown: /brown|tan|beige|khaki|camel/i,
      orange: /orange|rust|copper/i,
    };
    
    const detectedColors = Object.entries(colorPatterns)
      .filter(([_, pattern]) => pattern.test(lowerDesc))
      .map(([color]) => color);
    
    const isVintage = /vintage|retro|throwback|90s|80s|old school/i.test(lowerDesc);
    const isNew = /new|unworn|nwt|new with tags|mint|brand new/i.test(lowerDesc);
    
    const category = currentItem.category || 'item';
    const colorDesc = detectedColors.length > 0 ? ` ${detectedColors[0]}` : '';
    
    let desc = `Discover this ${isNew ? 'brand new' : isVintage ? 'vintage' : 'quality'}${colorDesc} ${category.toLowerCase()} piece. `;
    desc += voiceDesc.charAt(0).toUpperCase() + voiceDesc.slice(1);
    if (!voiceDesc.endsWith('.')) desc += '.';
    desc += ' Perfect for any wardrobe. Don\'t miss out on this quality piece.';
    
    const targetIds = new Set(currentGroup.map(g => g.id));
    setProcessedItems(prev => {
      const updated = [...prev];
      updated.forEach((item, idx) => {
        if (targetIds.has(item.id)) {
          updated[idx] = { ...updated[idx], generatedDescription: desc };
        }
      });
      return updated;
    });
    setIsGenerating(false);
  };

  // Regenerate functions - currently unused but kept for future reference
  /*
  const regenerateSeoTitle = () => {
    const category = currentItem.category || 'Item';
    const voiceDesc = currentItem.voiceDescription || '';
    const size = currentItem.size || '';
    const lowerDesc = voiceDesc.toLowerCase();
    
    // Detect all colors
    const colorPatterns = {
      black: /black/i,
      white: /white|cream|ivory/i,
      red: /red|crimson|burgundy/i,
      blue: /blue|navy|cobalt/i,
      green: /green|olive|forest/i,
      yellow: /yellow|gold/i,
      pink: /pink|rose/i,
      purple: /purple|violet/i,
      gray: /gray|grey|charcoal/i,
      brown: /brown|tan|beige/i,
      orange: /orange|rust/i,
    };
    
    const detectedColors = Object.entries(colorPatterns)
      .filter(([_, pattern]) => pattern.test(lowerDesc))
      .map(([color]) => color);
    
    const titleParts = [];
    
    // Add ALL detected colors only if not empty
    if (detectedColors.length > 0) {
      const colorStr = detectedColors.length === 1 
        ? detectedColors[0].charAt(0).toUpperCase() + detectedColors[0].slice(1)
        : detectedColors.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' and ');
      if (colorStr && colorStr.trim() !== '') {
        titleParts.push(colorStr);
      }
    }
    
    // Add category
    if (category) titleParts.push(category === 'Tees' ? 'T-Shirt' : category.slice(0, -1));
    
    // Add key descriptor
    const descriptorMatch = voiceDesc.match(/\b(Lakers|athletic|logo|graphic|print|stripe|solid|crew|v-neck|hoodie|pullover|zip|button)\b/i);
    if (descriptorMatch) {
      titleParts.push(descriptorMatch[0].charAt(0).toUpperCase() + descriptorMatch[0].slice(1));
    }
    
    // Add size only if not empty
    if (size && size.trim() !== '') {
      titleParts.push(`(${size})`);
    }
    
    // NO HARD LIMIT - let it be natural length
    const title = titleParts.join(' ');
    
    const updated = [...processedItems];
    currentGroup.forEach(groupItem => {
      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
      if (itemIndex !== -1) {
        updated[itemIndex].seoTitle = title;
      }
    });
    setProcessedItems(updated);
  };

  const regenerateTags = () => {
    const category = currentItem.category || '';
    const voiceDesc = currentItem.voiceDescription || '';
    const size = currentItem.size || '';
    const lowerDesc = voiceDesc.toLowerCase();
    
    const colorPatterns = {
      black: /black/i,
      white: /white|cream|ivory/i,
      red: /red|crimson|burgundy/i,
      blue: /blue|navy|cobalt/i,
      green: /green|olive|forest/i,
      gray: /gray|grey|charcoal/i,
    };
    
    const detectedColors = Object.entries(colorPatterns)
      .filter(([_, pattern]) => pattern.test(lowerDesc))
      .map(([color]) => color);
    
    const tags = [
      category.toLowerCase(),
      ...detectedColors,
      ...(size ? [size.toLowerCase()] : []),
      'fashion',
      'streetwear',
    ].filter(t => t && t.trim() !== '');
    
    const manualTags = currentItem.tags || [];
    const finalTags = [...new Set([...manualTags, ...tags])];
    
    const updated = [...processedItems];
    currentGroup.forEach(groupItem => {
      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
      if (itemIndex !== -1) {
        updated[itemIndex].tags = finalTags;
      }
    });
    setProcessedItems(updated);
  };
  */

  // regenerateSize function - currently unused but kept for future reference
  /*
  const regenerateSize = () => {
    if (!currentItem.voiceDescription) {
      alert('Please add a voice description first');
      return;
    }
    
    const lowerDesc = currentItem.voiceDescription.toLowerCase();
    
    const sizePatterns = [
      /\b(extra[\s-]?large|x[\s-]?large|xl)\b/i,
      /\b(double[\s-]?extra[\s-]?large|double[\s-]?xl|xx[\s-]?large|xxl)\b/i,
      /\b(triple[\s-]?extra[\s-]?large|triple[\s-]?xl|xxx[\s-]?large|xxxl)\b/i,
      /\b(extra[\s-]?small|x[\s-]?small|xs)\b/i,
      /\b(small|sm)\b/i,
      /\b(medium|med|md|m)\b/i,
      /\b(large|lg|l)\b/i,
      /\b([0-9]{1,2})\b/i,
    ];
    
    let detectedSize = null;
    for (const pattern of sizePatterns) {
      const match = lowerDesc.match(pattern);
      if (match) {
        let size = match[1].toUpperCase();
        if (/extra[\s-]?large|x[\s-]?large/i.test(size)) size = 'XL';
        else if (/double.*xl|xx.*large/i.test(size)) size = 'XXL';
        else if (/triple.*xl|xxx.*large/i.test(size)) size = 'XXXL';
        else if (/extra[\s-]?small|x[\s-]?small/i.test(size)) size = 'XS';
        else if (/small|sm/i.test(size)) size = 'S';
        else if (/medium|med|md/i.test(size)) size = 'M';
        else if (/large|lg/i.test(size) && !/x/i.test(size)) size = 'L';
        
        detectedSize = size;
        break;
      }
    }
    
    if (detectedSize) {
      const updated = [...processedItems];
      currentGroup.forEach(groupItem => {
        const itemIndex = updated.findIndex(item => item.id === groupItem.id);
        if (itemIndex !== -1) {
          updated[itemIndex].size = detectedSize;
        }
      });
      setProcessedItems(updated);
    } else {
      alert('No size detected in voice description');
    }
  };
  */

  // ── Thumbnail photo reorder handlers ──────────────────────────────────────
  const handleThumbDragStart = (e: React.DragEvent, photoId: string) => {
    console.log(`[Step4:PDG] thumbDragStart | photo=${photoId} groupIndex=${currentGroupIndex}`);
    setDraggedThumbId(photoId);
    e.dataTransfer.setData('application/json', JSON.stringify({ action: 'reorder-thumb', photoId }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleThumbDragOver = (e: React.DragEvent, photoId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedThumbId !== photoId) setDragOverThumbId(photoId);
  };

  const handleThumbDrop = (e: React.DragEvent, targetPhotoId: string) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`[Step4:PDG] thumbDrop | from=${draggedThumbId} → to=${targetPhotoId} groupIndex=${currentGroupIndex}`);

    let srcPhotoId: string | null = null;
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.action === 'reorder-thumb') srcPhotoId = data.photoId;
    } catch { /* ignore */ }
    srcPhotoId = srcPhotoId || draggedThumbId;

    if (!srcPhotoId || srcPhotoId === targetPhotoId) {
      setDraggedThumbId(null); setDragOverThumbId(null); return;
    }

    const groupId = currentGroup[0]?.productGroup || currentGroup[0]?.id;
    const groupItems = [...currentGroup];
    const fromIdx = groupItems.findIndex(p => p.id === srcPhotoId);
    const toIdx = groupItems.findIndex(p => p.id === targetPhotoId);
    if (fromIdx === -1 || toIdx === -1) return;

    const moved = groupItems.splice(fromIdx, 1)[0];
    groupItems.splice(toIdx, 0, moved);

    // Replace the reordered group's items in-place so that the group's
    // position in processedItems (and therefore groupArray) never changes.
    // This keeps currentGroupIndex pointing at the same product group.
    let groupSlot = 0;
    const nextItemsFinal = processedItems.map(item => {
      const itemGroupId = item.productGroup || item.id;
      if (itemGroupId !== groupId) return item;
      return groupItems[groupSlot++];
    });

    setProcessedItems(nextItemsFinal);
    setDraggedThumbId(null); setDragOverThumbId(null);
  };

  const handleThumbDragEnd = () => {
    setDraggedThumbId(null);
    setDragOverThumbId(null);
  };

  const handleNext = () => {
    console.log(`[Step4:PDG] next | ${currentGroupIndex} → ${currentGroupIndex + 1} of ${groupArray.length - 1}`);
    // Auto-save in background — no waiting, no blocking navigation
    if (hasUnsavedChanges) handleSave();
    if (currentGroupIndex < groupArray.length - 1) {
      setCurrentGroupIndex(currentGroupIndex + 1);
      // Scroll to top of Step 4 section
      const container = document.querySelector('.product-description-container');
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const handlePrevious = () => {
    console.log(`[Step4:PDG] previous | ${currentGroupIndex} → ${currentGroupIndex - 1}`);
    // Auto-save in background — no waiting, no blocking navigation
    if (hasUnsavedChanges) handleSave();
    if (currentGroupIndex > 0) {
      setCurrentGroupIndex(currentGroupIndex - 1);
      // Scroll to top of Step 4 section
      const container = document.querySelector('.product-description-container');
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const handleFinish = () => {
    const allProcessed = processedItems.every(
      item => item.voiceDescription && item.generatedDescription
    );
    console.log(`[Step4:PDG] finish | allProcessed=${allProcessed} | total=${processedItems.length}`);
    
    if (allProcessed) {
      onProcessed(processedItems);
    } else {
      alert('Please process all items before continuing');
    }
  };

  return (
    <div className="product-description-container">
      <div className="progress-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span>Product Group {currentGroupIndex + 1} of {groupArray.length}</span>
          {/* Badges — image count + category — top-left */}
          <span className="group-info-badge">
            {currentGroup.length} {currentGroup.length === 1 ? 'image' : 'images'}
          </span>
          {currentItem.category && (
            <span className="category-badge">{currentItem.category}</span>
          )}
        </div>
        {/* Checkbox — top-right — selects this group for bulk preset apply */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.875rem', color: '#374151', userSelect: 'none', marginLeft: 'auto' }}
          title="Select group for bulk preset apply"
        >
          <input
            type="checkbox"
            checked={selectedGroupIds.has(currentItem.productGroup || currentItem.id)}
            onChange={(e) => {
              const groupId = currentItem.productGroup || currentItem.id;
              setSelectedGroupIds(prev => {
                const next = new Set(prev);
                if (e.target.checked) next.add(groupId);
                else next.delete(groupId);
                return next;
              });
            }}
            style={{ width: '1rem', height: '1rem', cursor: 'pointer', accentColor: '#6366f1' }}
          />
          <span>Select</span>
        </label>
        <div className="progress-fill" style={{ width: `${((currentGroupIndex + 1) / groupArray.length) * 100}%` }} />
      </div>

      <div className="product-editor">
        <div className="product-preview">
          <div
            className="preview-image-wrap"
            ref={mainPreviewRef}
            onMouseMove={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const xPct = (e.clientX - rect.left) / rect.width;
              const yPct = (e.clientY - rect.top) / rect.height;
              setMagnifier({
                src: currentItem.preview || currentItem.imageUrls?.[0] || '',
                x: e.clientX,
                y: e.clientY,
                bgX: xPct * 100,
                bgY: yPct * 100,
              });
            }}
            onMouseLeave={() => setMagnifier(null)}
          >
            <LazyImg
              src={currentItem.preview || currentItem.imageUrls?.[0] || ''}
              alt="Product"
              className="preview-image"
              style={{ cursor: 'zoom-in' }}
              onDoubleClick={() => setLightboxSrc(currentItem.preview || currentItem.imageUrls?.[0] || '')}
            />
          </div>
          <div className="product-info">
          </div>
          {currentGroup.length > 1 && (
            <div className="group-thumbnails">
              <p><strong>All images in this group:</strong></p>
              <div className="thumbnail-grid">
                {currentGroup.map((groupItem, idx) => (
                  <div
                    key={groupItem.id}
                    className={`group-thumbnail-wrap thumb-draggable${draggedThumbId === groupItem.id ? ' thumb-dragging' : ''}${dragOverThumbId === groupItem.id ? ' thumb-drag-over' : ''}`}
                    draggable
                    onDragStart={(e) => handleThumbDragStart(e, groupItem.id)}
                    onDragOver={(e) => handleThumbDragOver(e, groupItem.id)}
                    onDrop={(e) => handleThumbDrop(e, groupItem.id)}
                    onDragEnd={handleThumbDragEnd}
                    onDragLeave={() => setDragOverThumbId(null)}
                    onDoubleClick={() => setLightboxSrc(groupItem.preview || groupItem.imageUrls?.[0] || '')}
                    title={`Image ${idx + 1} — double-click to expand`}
                  >
                    <LazyImg
                      src={groupItem.preview || groupItem.imageUrls?.[0] || ''}
                      alt={`Image ${idx + 1}`}
                      className="group-thumbnail"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Navigation — cycles through product groups */}
          <div className="preview-nav-controls">
            <button
              className="button button-secondary"
              onClick={handlePrevious}
              disabled={currentGroupIndex === 0}
            >
              ← Prev
            </button>
            <span className="preview-nav-counter">
              {currentGroupIndex + 1} / {groupArray.length}
            </span>
            {currentGroupIndex < groupArray.length - 1 ? (
              <button className="button" onClick={handleNext}>
                Next →
              </button>
            ) : (
              <button className="button button-secondary" onClick={handleFinish}>
                Finish ✓
              </button>
            )}
          </div>

          {/* Download CSV — quick access below nav */}
          {/* Save Changes button — explicit Supabase push */}
          <button
            className="button"
            onClick={handleSave}
            disabled={isSaving || (!hasUnsavedChanges && !saveConfirmed)}
            style={{
              marginTop: '0.5rem',
              width: '100%',
              justifyContent: 'center',
              fontSize: '0.8125rem',
              background: saveConfirmed
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : hasUnsavedChanges
                  ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                  : '#9ca3af',
              cursor: isSaving || (!hasUnsavedChanges && !saveConfirmed) ? 'default' : 'pointer',
              opacity: isSaving ? 0.7 : 1,
              transition: 'background 0.3s',
            }}
          >
            {isSaving ? '⏳ Saving…' : saveConfirmed ? '✅ Saved!' : hasUnsavedChanges ? '💾 Save Changes' : '💾 Save Changes'}
          </button>

          {/* Download CSV — quick access below nav */}
          {onDownloadCSV && (
            <button
              className="button"
              onClick={onDownloadCSV}
              style={{
                marginTop: '0.5rem',
                width: '100%',
                justifyContent: 'center',
                fontSize: '0.8125rem',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              }}
            >
              💾 Download CSV
            </button>
          )}
        </div>

        <div className="product-form">
          <div className="form-section">
            <h3>Voice Description</h3>
            {!speechSupported && (
              <div className="voice-warning">
                ⚠️ Speech recognition not supported. Please use Chrome or Edge browser.
              </div>
            )}
            <div className="voice-controls">
              <button 
                type="button"
                className={`button ${isRecording ? '' : 'button-secondary'}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isRecording) {
                    handleStopRecording();
                  } else {
                    handleStartRecording();
                  }
                }}
                disabled={!speechSupported || isTransitioning}
                style={isRecording ? { background: '#ef4444' } : undefined}
              >
                {isTransitioning ? '⏳ Wait...' : (isRecording ? '⏹ Stop Recording' : '🎤 Start Recording')}
              </button>
              {currentItem.voiceDescription && !isRecording && (
                <button 
                  className="button" 
                  onClick={handleClearTranscript}
                  style={{ background: '#f59e0b' }}
                >
                  🗑️ Clear
                </button>
              )}
            </div>
            {isRecording && (
              <div className="recording-indicator">
                <div className="recording-pulse"></div>
                <span>Listening... Speak now</span>
              </div>
            )}
            {interimTranscript && (
              <div className="interim-transcript">
                <p><em>Recognizing: {interimTranscript}</em></p>
              </div>
            )}
            <div className="voice-result">
              <label><strong>Voice Description (edit as needed):</strong></label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                {/* Command key reference table */}
                <div style={{
                  flexShrink: 0,
                  width: '150px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '0.5rem 0.6rem',
                  fontSize: '0.7rem',
                  lineHeight: '1.6',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.3rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>Voice Commands</div>
                  {[
                    ['color', 'red'],
                    ['brand', 'Nike'],
                    ['size', 'large'],
                    ['material', 'cotton'],
                    ['condition', 'good'],
                    ['price', '$20'],
                    ['era', '90s'],
                    ['style', 'casual'],
                    ['gender', 'women'],
                    ['flaws', 'small hole'],
                    ['care', 'hand wash'],
                    ['width', '18 inches'],
                    ['length', '28 inches'],
                  ].map(([field, ex]) => (
                    <div key={field} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.25rem' }}>
                      <span style={{ color: '#6366f1', fontWeight: 600 }}>{field}</span>
                      <span style={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'right' }}>{ex} <span style={{ color: '#cbd5e1' }}>•</span></span>
                    </div>
                  ))}
                  <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid #e2e8f0', color: '#94a3b8', fontSize: '0.63rem' }}>
                    Say <strong style={{ color: '#6366f1' }}>period</strong> to end each field
                  </div>
                </div>
                {/* Textarea */}
                <textarea 
                  value={formatVoiceTranscript(currentItem.voiceDescription || interimTranscript || '')}
                  onChange={(e) => {
                    // Clear interimTranscript so user edits aren't overridden by live recognition
                    setInterimTranscript('');
                    const updated = [...processedItems];
                    currentGroup.forEach(groupItem => {
                      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                      if (itemIndex !== -1) {
                        updated[itemIndex] = {
                          ...updated[itemIndex],
                          voiceDescription: e.target.value,
                          generatedDescription: updated[itemIndex].generatedDescription
                            ? `[Voice updated — click Generate to refresh]\n\n${updated[itemIndex].generatedDescription}`
                            : updated[itemIndex].generatedDescription,
                        };
                      }
                    });
                    setProcessedItems(updated);
                  }}
                  placeholder={"Start Recording and speak...\n\nExample:\n  color black period\n  brand Nike period\n  size large period"}
                  rows={8}
                  className="description-textarea"
                  style={{ flex: 1, minWidth: 0 }}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>

            {/* AI Description — sits directly below the voice box */}
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                AI Generated Description:
              </label>
              <textarea
                value={currentItem.generatedDescription}
                onChange={(e) => {
                  const updated = [...processedItems];
                  currentGroup.forEach(groupItem => {
                    const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                    if (itemIndex !== -1) {
                      updated[itemIndex].generatedDescription = e.target.value;
                    }
                  });
                  setProcessedItems(updated);
                }}
                className="info-textarea"
                rows={6}
                style={{ width: '100%' }}
              />
              <button
                className="button button-primary"
                onClick={regenerateDescription}
                disabled={isGenerating || isSyncingFields}
                style={{
                  marginTop: '0.5rem',
                  width: '100%',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                }}
                title="Generate professional description from your voice + fields"
              >
                {isGenerating ? '🧠 Generating...' : '✨ Generate AI Description'}
              </button>
              <button
                className="button"
                onClick={syncFieldsFromDescription}
                disabled={isSyncingFields || isGenerating}
                style={{
                  marginTop: '0.5rem',
                  width: '100%',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#fff',
                  border: 'none',
                }}
                title="Parse the description text and update all structured fields"
              >
                {isSyncingFields ? '🔄 Syncing fields...' : '🔁 Sync Fields from Description'}
              </button>
              <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem', marginBottom: 0 }}>
                AI will create a professional description from your voice input and fields
              </p>
            </div>
            
            {/* Display Intelligent Match Results */}
            {currentItem.modelName && (
              <div className="match-results" style={{
                marginTop: '1rem',
                padding: '1rem',
                background: '#f0f9ff',
                border: '2px solid #3b82f6',
                borderRadius: '8px'
              }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Target size={18} /> Intelligent Match Detected
                </h4>
                <div style={{ fontSize: '0.9rem', display: 'grid', gap: '0.5rem' }}>
                  {currentItem.brand && <div><strong>Brand:</strong> {currentItem.brand}</div>}
                  {currentItem.modelName && <div><strong>Model:</strong> {currentItem.modelName} {currentItem.modelNumber && `(${currentItem.modelNumber})`}</div>}
                  {currentItem.brandCategory && <div><strong>Category:</strong> {currentItem.brandCategory}</div>}
                  {currentItem.subculture && currentItem.subculture.length > 0 && (
                    <div><strong>Subcultures:</strong> {currentItem.subculture.join(', ')}</div>
                  )}
                </div>
              </div>
            )}

            {/* Category Preset Applied Indicator */}
            {currentItem._presetData && (
              <div style={{
                marginBottom: '1.5rem',
                padding: '1rem',
                background: '#f0fdf4',
                border: '2px solid #10b981',
                borderRadius: '8px'
              }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#047857', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  ✓ Category Preset Applied
                </h4>
                <div style={{ fontSize: '0.9rem', display: 'grid', gap: '0.5rem' }}>
                  <div><strong>Category:</strong> {currentItem._presetData.displayName}</div>
                  {currentItem._presetData.description && (
                    <div style={{ color: '#666', fontStyle: 'italic' }}>{currentItem._presetData.description}</div>
                  )}
                  <div style={{ fontSize: '0.85rem', color: '#059669', marginTop: '0.5rem' }}>
                    📋 Form fields have been pre-filled with preset defaults. You can edit any field to override.
                  </div>
                </div>
              </div>
            )}

            {/* Manual Preset Override Dropdown */}
            {availablePresets.length > 0 && (
              <div style={{
                marginBottom: '1.5rem',
                padding: '1rem',
                background: selectedGroupIds.size > 0 ? '#eff6ff' : '#f8f9fa',
                border: selectedGroupIds.size > 0 ? '1px solid #6366f1' : '1px solid #dee2e6',
                borderRadius: '8px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label style={{ 
                    fontWeight: 600, 
                    color: '#495057'
                  }}>
                    🎨 Override Preset (Optional):
                  </label>
                  {selectedGroupIds.size > 0 && (
                    <span style={{ fontSize: '0.8rem', color: '#6366f1', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      ✦ {selectedGroupIds.size} group{selectedGroupIds.size > 1 ? 's' : ''} selected — will apply to all
                      <button
                        onClick={() => setSelectedGroupIds(new Set())}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '0.85rem', padding: '0 0.2rem' }}
                        title="Clear selection"
                      >✕</button>
                    </span>
                  )}
                </div>
                <select
                  value={selectedPresetId}
                  onChange={(e) => handleApplyPreset(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #ced4da',
                    borderRadius: '4px',
                    fontSize: '0.95rem',
                    background: 'white',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">
                    {currentItem._presetData 
                      ? `Keep Current: ${currentItem._presetData.displayName}` 
                      : 'Select a preset to apply...'}
                  </option>
                  {availablePresets.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.display_name}
                      {preset.is_default && ' (Default)'}
                      {preset.product_type && ` - ${preset.product_type}`}
                    </option>
                  ))}
                </select>
                <p style={{ 
                  fontSize: '0.85rem', 
                  color: '#6c757d', 
                  marginTop: '0.5rem',
                  marginBottom: 0
                }}>
                  💡 Select a different preset to override the current one. Voice dictation always takes precedence.
                </p>
              </div>
            )}
          </div>

          {/* Comprehensive Product Form - All 62 CSV Fields */}
          <div className="form-section">
            <h3>Product Info</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
              Fields pre-filled from category preset. Voice dictation takes precedence. Edit any field as needed.
            </p>
            
            <ComprehensiveProductForm
              currentItem={currentItem}
              currentGroup={currentGroup}
              processedItems={processedItems}
              setProcessedItems={setProcessedItems}
            />
          </div>
        </div>
      </div>

      {/* Cursor-following magnifier lens */}
      {magnifier && (
        <div
          className="magnifier-lens"
          style={{
            left: magnifier.x + 16,
            top: magnifier.y - 100,
            backgroundImage: `url(${magnifier.src})`,
            backgroundPosition: `${magnifier.bgX}% ${magnifier.bgY}%`,
            backgroundSize: '300%',
          }}
        />
      )}

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
    </div>
  );
};

export default ProductDescriptionGenerator;
