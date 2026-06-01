import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ClothingItem } from '../App';
import { Target } from 'lucide-react';
import { ComprehensiveProductForm } from './ComprehensiveProductForm';
import { getCategoryPresets } from '../lib/categoryPresetsService';
import type { CategoryPreset } from '../lib/categoryPresets';
import { applyPresetToProductGroup, applyPresetDirectly } from '../lib/applyPresetToGroup';
import { generateProductDescription, formatVoiceTranscript, smartSeoTruncate } from '../lib/textAIService';
import { syncGroupFieldsToDatabase } from '../lib/productService';
import LazyImg from './LazyImg';
import { log } from '../lib/debugLogger';
import VoiceCommandTable, { VOICE_KEYWORD_TO_FIELD } from './VoiceCommandTable';
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
  const [presetSearchQuery, setPresetSearchQuery] = useState('');
  const [presetSearchOpen, setPresetSearchOpen] = useState(false);
  const [appliedPresetLabel, setAppliedPresetLabel] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Voice command table
  const [voiceMode, setVoiceMode] = useState<'table' | 'text'>('table');
  const [activeVoiceField, setActiveVoiceField] = useState<string | null>(null);
  const activeVoiceFieldRef = useRef<string | null>(null);
  const pendingFieldValueRef = useRef<string>(''); // accumulates spoken value for active field
  // Always-current handleTableFieldChange so onresult closure never goes stale
  const applyTableFieldRef = useRef<(field: string, value: string) => void>(() => {});

  // Photo reorder drag state (Step 4 thumbnails)
  const [draggedThumbId, setDraggedThumbId] = useState<string | null>(null);
  const [dragOverThumbId, setDragOverThumbId] = useState<string | null>(null);

  // Lightbox / edit-modal state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null);
  // ordered list of item ids the user can arrow through in the current lightbox session
  const [lightboxPool, setLightboxPool] = useState<string[]>([]);

  const openLightbox = (src: string, itemId: string, pool: string[]) => {
    setLightboxSrc(src);
    setLightboxItemId(itemId);
    setLightboxPool(pool);
  };
  const closeLightbox = () => {
    setLightboxSrc(null);
    setLightboxItemId(null);
    setLightboxPool([]);
  };
  const navigateLightbox = (dir: 1 | -1) => {
    if (!lightboxItemId || lightboxPool.length < 2) return;
    const idx = lightboxPool.indexOf(lightboxItemId);
    const nextIdx = (idx + dir + lightboxPool.length) % lightboxPool.length;
    const nextId = lightboxPool[nextIdx];
    const nextItem = processedItems.find(i => i.id === nextId);
    if (!nextItem) return;
    const src = nextItem.preview || nextItem.imageUrls?.[0] || '';
    setLightboxSrc(src);
    setLightboxItemId(nextId);
  };
  const [cropModal, setCropModal] = useState<{ open: boolean; itemId?: string }>(() => ({ open: false }));
  const [tempCrop, setTempCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Clipboard for crop — holds {x,y,w,h} percentages so user can paste to many items
  const [copiedCrop, setCopiedCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropPasteProgress, setCropPasteProgress] = useState<{ done: number; total: number } | null>(null);

  // Magnifier state — cursor-following zoom lens on main preview image
  const [magnifier, setMagnifier] = useState<{ src: string; x: number; y: number; bgX: number; bgY: number } | null>(null);
  const mainPreviewRef = useRef<HTMLDivElement | null>(null);

  // Magnifier settings — persisted to localStorage so they survive navigation
  const [magnifierSettings, setMagnifierSettings] = useState<{ size: number; zoom: number; enabled: boolean }>(() => {
    try {
      const saved = localStorage.getItem('sortbot_magnifier_settings');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { size: 360, zoom: 5, enabled: true };
  });
  const updateMagnifierSettings = (patch: Partial<typeof magnifierSettings>) => {
    setMagnifierSettings(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem('sortbot_magnifier_settings', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

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

  // Helper: build group array from items with groups-first ordering
  const buildGroupArray = (items: ClothingItem[]): ClothingItem[][] => {
    const productGroups = items.reduce((groups, item, idx) => {
      const groupId = item.productGroup || item.id;
      if (!groups[groupId]) groups[groupId] = { items: [], firstIdx: idx };
      groups[groupId].items.push(item);
      return groups;
    }, {} as Record<string, { items: ClothingItem[]; firstIdx: number }>);
    // Sort: multi-item groups first, then singles — stable tiebreaker is the index
    // of the first photo in that group within the original items array, so order
    // never shuffles when processedItems state updates.
    return Object.values(productGroups)
      .sort((a, b) => {
        const aMulti = a.items.length > 1 ? 0 : 1;
        const bMulti = b.items.length > 1 ? 0 : 1;
        if (aMulti !== bMulti) return aMulti - bMulti;
        return a.firstIdx - b.firstIdx; // stable tiebreaker
      })
      .map(g => g.items);
  };

  // Memoize group calculation to avoid unnecessary recalculations
  const { groupArray, currentGroup, currentItem } = useMemo(() => {
    const groupArray = buildGroupArray(processedItems);
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
  }, [processedItems]);

  // Update local state when items prop changes (e.g., opening a different batch)
  // Reset whenever batchId changes, or items array reference/length/content changes
  useEffect(() => {
    const batchChanged = batchId !== previousBatchIdRef.current;
    const lengthChanged = items.length !== previousItemsLengthRef.current;
    // Also detect same-length but different content (e.g. re-group same number of items)
    const firstIdChanged = items[0]?.id !== previousItemsRefRef.current[0]?.id;
    // Detect category or productGroup changes on existing items — e.g. re-categorizing an
    // item already in the list, or applying a preset to already-categorized items.
    // Without this, PDG's internal state stays stale (shows old category/preset fields)
    // until the user navigates away and back, appearing as a "requires refresh" bug.
    const structureKey = items.map(i => `${i.id}:${i.category ?? ''}:${i.productGroup ?? ''}`).join('|');
    const prevStructureKey = previousItemsRefRef.current.map(i => `${i.id}:${i.category ?? ''}:${i.productGroup ?? ''}`).join('|');
    const structureChanged = structureKey !== prevStructureKey;

    // Major changes (batch switch, new items, reordered) reset navigation to group 0.
    // Structure-only changes (re-categorize, preset apply) silently sync without disrupting
    // the user's current position in the group list.
    const shouldReset = batchChanged || lengthChanged || firstIdChanged;
    const shouldSync = shouldReset || structureChanged;

    if (shouldSync) {
      isResettingRef.current = true;
      setProcessedItems(items);
      if (shouldReset) {
        setCurrentGroupIndex(0); // Only reset navigation for major changes
      }
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
          // "wits 18" / "what's 18" / "whats 18" before a number → "width 18"
          .replace(/\b(wits|what's|whats|wit's)\b(?=\s+\d)/gi, 'width')
          .replace(/\bwith\b(?=\s+\d)/gi, 'width')   // "with 18 inches" → "width 18 inches"
          .replace(/\bwidth\b(?=\s+(a|an|the)\b)/gi, 'with') // "width a great" → "with a great"
          .replace(/\bwidth\b(?=\s+[a-z]{3,}(?!\s*\d))/gi, 'with') // "width nice" → "with nice"
          // Common measurement word misrecognitions
          .replace(/\b(shows|shower|shoulder's|shoulders)\b(?=\s+\d)/gi, 'shoulder')
          .replace(/\b(waste|ways|waist's)\b(?=\s+\d)/gi, 'waist')
          .replace(/\b(in seam|in-seam|unseam)\b/gi, 'inseam')
          .replace(/\b(out seam|out-seam)\b/gi, 'outseam')
          .replace(/\b(chest's|chess|jest)\b(?=\s+\d)/gi, 'chest')
          .replace(/\b(hip's|hips)\b(?=\s+\d)/gi, 'hip')
          .replace(/\b(sleeve's|sleeves)\b(?=\s+\d)/gi, 'sleeve')
          .replace(/\b(length's|lengths)\b(?=\s+\d)/gi, 'length')
          // "30 and a half" / "30 and half" → "30.5"
          .replace(/(\d+)\s+and\s+a?\s*half\b/gi, (_, n) => String(parseFloat(n) + 0.5))
          // Normalize "inches" / "inch" / "in." after a number so the number is clean
          .replace(/(\d+(?:\.\d+)?)\s*(?:inches|inch|in\.)\b/gi, '$1');

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
          
          // Recalculate groups from updated items (same sort order as main groupArray)
          const updatedGroupArray = buildGroupArray(updated);
          const currentGroup = updatedGroupArray[currentGroupIndex];
          const currentItem = currentGroup[0];
          const currentDescription = currentItem.voiceDescription || '';
          
          // Apply voice description to all items in the current group
          currentGroup.forEach(groupItem => {
            const itemIndex = updated.findIndex(item => item.id === groupItem.id);
            if (itemIndex !== -1) {
              updated[itemIndex] = {
                ...updated[itemIndex],
                voiceDescription: formatVoiceTranscript((currentDescription + final).trim())
              };
            }
          });
          
          return updated;
        });
        
        setInterimTranscript('');

        // Detect active column from final chunk — clear on period/dot, set on keyword
        const finalLower = final.toLowerCase();
        const hasPeriod = /\bperiod\b/i.test(final);

        // Find last keyword in this chunk
        let lastPos = -1;
        let lastKey: string | null = null;
        let lastKeyword = '';
        for (const [keyword, fieldKey] of Object.entries(VOICE_KEYWORD_TO_FIELD)) {
          const idx = finalLower.lastIndexOf(keyword);
          if (idx > lastPos) { lastPos = idx; lastKey = fieldKey; lastKeyword = keyword; }
        }

        if (hasPeriod) {
          // ── Multi-command chunked processing ─────────────────────────────
          // A single speech chunk can contain multiple commands, e.g.:
          //   "brand quicksilver period size xl period color blue period"
          // We walk through the chunk segment-by-segment, splitting on "period",
          // so fast speech never causes one field's value to bleed into another.

          // Split on "period" boundaries (case-insensitive)
          const segments = final.split(/\s*\bperiod\b\s*/i);
          // segments[last] is whatever came after the final "period" (often empty or next keyword)
          const trailingText = segments[segments.length - 1].trim();

          for (let si = 0; si < segments.length - 1; si++) {
            const seg = segments[si].trim();
            if (!seg) continue;

            const segLower = seg.toLowerCase();
            // Find if this segment starts with a field keyword
            let segField: string | null = null;
            let segKeywordLen = 0;
            for (const [kw, fk] of Object.entries(VOICE_KEYWORD_TO_FIELD)) {
              if (segLower.startsWith(kw + ' ') || segLower === kw) {
                if (kw.length > segKeywordLen) {
                  segField = fk; segKeywordLen = kw.length;
                }
              }
            }

            if (segField) {
              // Segment begins a new command — apply any previously pending field first
              const prevField = activeVoiceFieldRef.current;
              const prevValue = pendingFieldValueRef.current.trim();
              if (prevField && prevValue) {
                applyTableFieldRef.current(prevField, prevValue);
              }
              // Now set up the new field from this segment
              const value = seg.slice(segKeywordLen).trim();
              pendingFieldValueRef.current = value;
              activeVoiceFieldRef.current = segField;
            } else if (activeVoiceFieldRef.current) {
              // Continuation of the active field
              pendingFieldValueRef.current = (pendingFieldValueRef.current + ' ' + seg).trim();
            }

            // Apply and clear — this segment's "period" closes the field
            const fieldToApply = activeVoiceFieldRef.current;
            const valueToApply = pendingFieldValueRef.current.trim();
            if (fieldToApply && valueToApply) {
              applyTableFieldRef.current(fieldToApply, valueToApply);
            }
            pendingFieldValueRef.current = '';
            activeVoiceFieldRef.current = null;
          }

          // Handle trailing text after the last "period" — it may be a new keyword
          // starting the next command (e.g. "... period size" — user hasn't said the value yet)
          if (trailingText) {
            const trailLower = trailingText.toLowerCase();
            let trailField: string | null = null;
            let trailKwLen = 0;
            for (const [kw, fk] of Object.entries(VOICE_KEYWORD_TO_FIELD)) {
              if (trailLower.startsWith(kw + ' ') || trailLower === kw) {
                if (kw.length > trailKwLen) { trailField = fk; trailKwLen = kw.length; }
              }
            }
            if (trailField) {
              const afterKw = trailingText.slice(trailKwLen).trim();
              activeVoiceFieldRef.current = trailField;
              pendingFieldValueRef.current = afterKw;
              setActiveVoiceField(trailField);
            } else {
              setActiveVoiceField(null);
            }
          } else {
            setActiveVoiceField(null);
          }
        } else if (lastKey) {
          // No period in chunk — new keyword detected, start accumulating value
          const afterKeyword = final.slice(lastPos + lastKeyword.length).trim();
          pendingFieldValueRef.current = afterKeyword;
          activeVoiceFieldRef.current = lastKey;
          setActiveVoiceField(lastKey);
        } else if (activeVoiceFieldRef.current) {
          // More text for the current active field
          pendingFieldValueRef.current = (pendingFieldValueRef.current + ' ' + final.trim()).trim();
        }

        // Don't restart automatically - continuous mode handles this
      } else {
        setInterimTranscript(interim);
        // Real-time column highlighting from interim text
        const interimLower = interim.toLowerCase();
        let lastPos = -1;
        let lastKey: string | null = null;
        for (const [keyword, fieldKey] of Object.entries(VOICE_KEYWORD_TO_FIELD)) {
          const idx = interimLower.lastIndexOf(keyword);
          if (idx > lastPos) { lastPos = idx; lastKey = fieldKey; }
        }
        if (lastKey) {
          activeVoiceFieldRef.current = lastKey;
          setActiveVoiceField(lastKey);
        }
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
        
        // Use functional update so we never clobber fields set by voice extraction
        // in a concurrent async operation (e.g. recording stop happening at the same time).
        setProcessedItems(prev => {
          const updated = [...prev];
          updatedGroup.forEach((updatedItem) => {
            const itemIndex = updated.findIndex(item => item.id === updatedItem.id);
            if (itemIndex !== -1) {
              updated[itemIndex] = updatedItem;
            }
          });
          return updated;
        });
        
        // Find and set the default preset ID in the dropdown
        const defaultPreset = availablePresets.find(p => 
          (p.product_type?.toLowerCase() === currentItem.category?.toLowerCase() || 
           p.category_name.toLowerCase() === currentItem.category?.toLowerCase()) &&
          p.is_default && 
          p.is_active
        );
        
        if (defaultPreset) {
          setSelectedPresetId(defaultPreset.id);
          setAppliedPresetLabel(defaultPreset.display_name);
        }
      } catch (error) {
        // Silently fail auto-apply
      }
    };

    if (availablePresets.length > 0) {
      autoApplyDefaultPreset();
    }
  }, [currentGroupIndex, currentItem?.category, availablePresets]); // Watch category changes too!

  // Keep the preset search label in sync when the user navigates to a different group
  useEffect(() => {
    setAppliedPresetLabel(currentItem?._presetData?.displayName || '');
    setPresetSearchQuery('');
    setPresetSearchOpen(false);
  }, [currentGroupIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply manual preset override
  const handleApplyPreset = async (presetId: string) => {
    if (!presetId) return;
    log.pdg(`handleApplyPreset | presetId=${presetId} selectedGroups=${selectedGroupIds.size}`);
    
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
      setAppliedPresetLabel(preset.display_name);
      if (selectedGroupIds.size > 0) setSelectedGroupIds(new Set());
    } catch (error) {
      alert('Failed to apply preset. Please try again.');
    }
  };

  const handleStartRecording = () => {
    if (isTransitioning) {
      return;
    }
    log.pdg('handleStartRecording');
    
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
    if (isTransitioning) {
      return;
    }
    log.pdg('handleStopRecording');
    
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
    activeVoiceFieldRef.current = null;
    pendingFieldValueRef.current = '';
    setActiveVoiceField(null);
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        // Ignore stop errors
      }
    }
    setInterimTranscript('');

    // AUTO-EXTRACT FIELDS FROM VOICE DESCRIPTION WHEN RECORDING STOPS
    // We wait a short tick so the final onresult setState flush has time to
    // propagate into processedItemsRef before we read it.  150 ms is plenty —
    // the browser fires onresult synchronously before onend, but the React
    // setState batching means the ref useEffect runs one render later.
    setTimeout(async () => {
      const latestItems = processedItemsRef.current;
      const latestGroupArray = buildGroupArray(latestItems);
      const latestGroup = latestGroupArray[currentGroupIndex] || [];
      const latestItem = latestGroup[0];

      // Capture target IDs before the async gap
      const targetIds = new Set(latestGroup.map(g => g.id));

      if (!latestItem?.voiceDescription) return;

      try {
        setIsGenerating(true);

        // Run the pure-JS field extractor directly — no network call needed.
        // extractFieldsFromVoice parses "brand Hanes period", "price 40 period",
        // "size L period", etc. and returns them as structured fields.
        const aiResult = await generateProductDescription({
          voiceDescription: latestItem.voiceDescription,
          title: latestItem.seoTitle || '',
          // Pass empty strings for all existing fields so voice ALWAYS wins —
          // the extractor returns only what was explicitly spoken, so if a field
          // wasn't mentioned it comes back undefined and the spread is a no-op.
          brand: '',
          color: '',
          size: '',
          material: '',
          condition: undefined,
          era: '',
          style: '',
          gender: '',
          // Prefer the preset's product_type over a potentially stale item.productType
          category: (latestItem as any)._presetData?.productType || latestItem.productType,
          presetTags: (latestItem as any)._presetData?.default_tags || [],
          measurements: undefined,
          flaws: '',
          care: '',
        });

        const extractedFields = aiResult.extractedFields || {};

        // Apply all extracted fields. Use functional update so we always write
        // into the true latest state, not the snapshot captured above.
        // voiceDescription is left untouched — the textarea shows the full
        // transcript so the user can review what was dictated.
        setProcessedItems(prev => {
          const updated = [...prev];
          updated.forEach((item, idx) => {
            if (!targetIds.has(item.id)) return;
            updated[idx] = {
              ...item,
              ...(extractedFields.brand     && { brand:          extractedFields.brand }),
              ...(extractedFields.modelName  && { modelName:      extractedFields.modelName }),
              ...(extractedFields.color      && { color:          extractedFields.color }),
              ...(extractedFields.secondaryColor && { secondaryColor: extractedFields.secondaryColor }),
              ...(extractedFields.size       && { size:           extractedFields.size }),
              ...(extractedFields.material   && { material:       extractedFields.material }),
              ...(extractedFields.condition  && { condition:      extractedFields.condition as 'New' | 'Used' | 'NWT' | 'Excellent' | 'Good' | 'Fair' }),
              ...(extractedFields.era        && { era:            extractedFields.era }),
              ...(extractedFields.style      && { style:          extractedFields.style }),
              ...(extractedFields.gender     && { gender:         extractedFields.gender as 'Men' | 'Women' | 'Unisex' | 'Kids' }),
              ...(extractedFields.measurements && { measurements: extractedFields.measurements }),
              ...(extractedFields.price      && { price:          parseFloat(extractedFields.price) || undefined }),
              ...(extractedFields.flaws      && { flaws:          extractedFields.flaws }),
              ...(extractedFields.care       && { care:           extractedFields.care }),
              ...(extractedFields.seoTitle   && { seoTitle:       extractedFields.seoTitle }),
              ...(extractedFields.tags && extractedFields.tags.length > 0 && {
                tags: [...new Set([...(item.tags || []), ...extractedFields.tags])].slice(0, 5)
              }),
            };
          });
          return updated;
        });

        // Auto-generate AI description from the just-extracted fields + voice text.
        // Pass the updated items directly so handleRegenerateAll doesn't read stale state.
        await handleRegenerateAll();

      } catch (error) {
        console.error('Error extracting fields from voice:', error);
      } finally {
        setIsGenerating(false);
      }
    }, 150);
  };

  // Background save — pushes current field values to Supabase products table.
  // Called automatically on Next/Prev navigation and on group index change.
  // workflow_state blob is always kept in sync separately via onProcessed().
  const handleSave = async () => {
    log.pdg(`handleSave | items=${processedItems.length} batchId=${batchId ?? 'none'}`);
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
      setHasUnsavedChanges(false);
    } catch {
      // Silently fail — workflow_state blob is the source of truth
    }
  };

  const handleClearTranscript = () => {
    log.pdg(`handleClearTranscript | groupSize=${currentGroup.length}`);
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

  /** Serialize item fields into voice-description "field value period" lines */
  const buildVoiceTextFromItem = (item: ClothingItem): string => {
    const lines: string[] = [];
    const add = (label: string, val: string | number | undefined | null) => {
      if (val !== undefined && val !== null && String(val).trim()) lines.push(`${label} ${String(val).trim()} period`);
    };
    add('title',    item.seoTitle);
    add('brand',    item.brand);
    add('size',     item.size);
    add('color',    item.color);
    if (item.secondaryColor) add('second color', item.secondaryColor);
    add('condition', item.condition);
    add('price',    item.price);
    add('era',      item.era);
    add('style',    item.style);
    add('gender',   item.gender);
    add('material', item.material);
    if (item.tags?.length) add('tags', item.tags.join(', '));
    add('flaws',    item.flaws);
    add('care',     item.care);
    const m = item.measurements as any;
    if (m) {
      add('chest',       m.chest);
      add('width',       m.width);
      add('length',      m.length);
      add('waist',       m.waist);
      add('hip',         m.hip);
      add('rise',        m.rise);
      add('inseam',      m.inseam);
      add('outseam',     m.outseam);
      add('leg opening', m.leg_opening);
      add('sleeve',      m.sleeve);
      add('shoulder',    m.shoulder);
    }
    return lines.join('\n');
  };

  /** Handle a cell edit from the VoiceCommandTable — updates fields AND rebuilds voiceDescription */
  const handleTableFieldChange = (fieldKey: string, value: string) => {
    const latestItems = processedItemsRef.current;
    const latestGroupArray = buildGroupArray(latestItems);
    const latestGroup = latestGroupArray[currentGroupIndex] || [];
    const targetIds = new Set(latestGroup.map(g => g.id));
    setProcessedItems(prev => prev.map(item => {
      if (!targetIds.has(item.id)) return item;
      let updated: ClothingItem;
      if (fieldKey.startsWith('meas_')) {
        const measKey = fieldKey.slice(5);
        updated = { ...item, measurements: { ...(item.measurements || {}), [measKey]: value } };
      } else if (fieldKey === 'price') {
        // Support both numeric ("45", "$45") and spoken-word prices ("forty five")
        const directNum = parseFloat(value.replace(/[^0-9.]/g, ''));
        let resolvedPrice: number | undefined = isNaN(directNum) ? undefined : directNum;
        if (!resolvedPrice) {
          const wordToNum: Record<string, number> = {
            zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
            eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,
            eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,
            seventy:70,eighty:80,ninety:90,hundred:100,
          };
          const tokens = value.toLowerCase().replace(/[^a-z\s]/g,'').replace(/\bdollars?\b/g,'').trim().split(/[\s-]+/);
          let total = 0, current = 0;
          for (const tok of tokens) {
            const n = wordToNum[tok];
            if (n === undefined) continue;
            if (n === 100) { current = (current || 1) * 100; }
            else if (n >= 20) { total += n; }
            else { current += n; }
          }
          total += current;
          if (total > 0) resolvedPrice = total;
        }
        updated = { ...item, price: resolvedPrice };
      } else if (fieldKey === 'tags') {
        updated = { ...item, tags: value.split(/,\s*/).filter(Boolean) };
      } else {
        updated = { ...item, [fieldKey]: value };
      }
      // Sync back to voiceDescription text
      updated = { ...updated, voiceDescription: buildVoiceTextFromItem(updated) };
      return updated;
    }));
  };

  // Keep applyTableFieldRef current every render
  applyTableFieldRef.current = handleTableFieldChange;

  // Banned phrases to filter from AI descriptions

  // Filter function to remove banned phrases

  // Sync structured fields from the edited description text
  const isSyncingFields = false;
  const isSyncingFromVoice = false;

  // Format painter — copy structured fields from one group and paste to another
  const [copiedFields, setCopiedFields] = useState<Record<string, any> | null>(null);

  // Combined: re-extract fields from voice + description, then regenerate AI description.
  // This is the single "Regenerate All" action used both from the button and auto-triggered
  // after stop-recording.  Accepts an optional snapshot of items (from the stop-recording
  // setTimeout path where processedItems state hasn't flushed yet).
  const handleRegenerateAll = async (itemsSnapshot?: typeof processedItems) => {
    const snap = itemsSnapshot ?? processedItems;
    const groupArray = buildGroupArray(snap);
    const group = groupArray[currentGroupIndex] || [];
    const item = group[0];
    if (!item) return;

    // Guard: if user has manually edited the description, confirm before overwriting
    const hasManualEdit = group.some(g => g.descriptionEdited);
    if (hasManualEdit) {
      const ok = window.confirm(
        'You have manually edited this description.\nRegenerate will overwrite your edits. Continue?'
      );
      if (!ok) return;
    }

    setIsGenerating(true);
    const targetIds = new Set(group.map(g => g.id));

    try {
      // ── Step 0: Re-apply the category preset (fresh from DB) so any changes
      //   made in Step 3 (Presets Manager) are picked up before AI generation.
      //   Only fills fields that are still empty — won't overwrite manual entries.
      let latestGroup = group;
      if (item.category) {
        const freshPresets = await getCategoryPresets();
        const matchingPreset =
          freshPresets.find(p =>
            p.is_active && p.is_default &&
            (p.product_type?.toLowerCase() === item.category!.toLowerCase() ||
             p.category_name.toLowerCase() === item.category!.toLowerCase())
          ) ||
          freshPresets.find(p =>
            p.is_active &&
            (p.product_type?.toLowerCase() === item.category!.toLowerCase() ||
             p.category_name.toLowerCase() === item.category!.toLowerCase())
          );
        if (matchingPreset) {
          latestGroup = applyPresetDirectly(group, item.category, matchingPreset);
          // Flush the preset-refreshed items back into state so the form reflects them
          setProcessedItems(prev => {
            const updated = [...prev];
            latestGroup.forEach(refreshed => {
              const idx = updated.findIndex(x => x.id === refreshed.id);
              if (idx !== -1) updated[idx] = refreshed;
            });
            return updated;
          });
        }
      }

      // Use the preset-refreshed item as source of truth for the AI call
      const refreshedItem = latestGroup[0];

      // ── Step 1: Re-extract from voice text only, then regenerate AI description
      // NOTE: never feed generatedDescription back in — it causes the content to repeat/loop
      const voiceText = refreshedItem.voiceDescription || '';

      if (!voiceText && !refreshedItem.brand && !refreshedItem.color && !refreshedItem.size) {
        return; // Nothing to work with
      }

      const aiResult = await generateProductDescription({
        voiceDescription: voiceText || undefined,
        title: refreshedItem.seoTitle || '',
        // Pass empty strings for all fields so voice/desc always wins
        brand: '',
        color: '',
        size: '',
        material: '',
        condition: undefined,
        era: '',
        style: '',
        gender: '',
        // Prefer the preset's product_type over a potentially stale item.productType
        category: (refreshedItem as any)._presetData?.productType || refreshedItem.productType,
        presetTags: (refreshedItem as any)._presetData?.default_tags || [],
        measurements: undefined,
        flaws: '',
        care: '',
      });

      const extractedFields = aiResult.extractedFields || {};
      const finalDescription = aiResult.description;

      setProcessedItems(prev => {
        const updated = [...prev];
        updated.forEach((it, idx) => {
          if (!targetIds.has(it.id)) return;
          updated[idx] = {
            ...it,
            generatedDescription: finalDescription,
            // Always sync seoTitle with the freshly generated title
            ...(aiResult.suggestedTitle && { seoTitle: aiResult.suggestedTitle }),
            ...(!it.seoDescription && finalDescription && { seoDescription: smartSeoTruncate(finalDescription) }),
            ...(extractedFields.brand        && { brand:           extractedFields.brand }),
            ...(extractedFields.modelName    && { modelName:       extractedFields.modelName }),
            ...(extractedFields.color        && { color:           extractedFields.color }),
            ...(extractedFields.secondaryColor && { secondaryColor: extractedFields.secondaryColor }),
            ...(extractedFields.size         && { size:            extractedFields.size }),
            ...(extractedFields.material     && { material:        extractedFields.material }),
            ...(extractedFields.condition    && { condition:       extractedFields.condition as 'New' | 'Used' | 'NWT' | 'Excellent' | 'Good' | 'Fair' }),
            ...(extractedFields.era          && { era:             extractedFields.era }),
            ...(extractedFields.style        && { style:           extractedFields.style }),
            ...(extractedFields.gender       && { gender:          extractedFields.gender as 'Men' | 'Women' | 'Unisex' | 'Kids' }),
            ...(extractedFields.measurements && { measurements:    extractedFields.measurements }),
            ...(extractedFields.price        && { price:           parseFloat(extractedFields.price) || undefined }),
            ...(extractedFields.flaws        && { flaws:           extractedFields.flaws }),
            ...(extractedFields.care         && { care:            extractedFields.care }),
            ...(extractedFields.seoTitle     && !it.seoTitle && { seoTitle: extractedFields.seoTitle }),
            ...(extractedFields.tags && extractedFields.tags.length > 0 && {
              tags: [...new Set([...(it.tags || []), ...extractedFields.tags])].slice(0, 5),
            }),
            descriptionEdited: false, // clear manual-edit flag after regeneration
          };
        });
        return updated;
      });
    } catch (error) {
      console.error('Regenerate all failed:', error);
    } finally {
      setIsGenerating(false);
    }
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
    log.pdg(`thumbDragStart | photoId=${photoId}`);
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
    log.pdg(`thumbDrop | from=${srcPhotoId} to=${targetPhotoId}`);
    setDraggedThumbId(null); setDragOverThumbId(null);
  };

  const handleThumbDragEnd = () => {
    setDraggedThumbId(null);
    setDragOverThumbId(null);
  };

  const handleNext = () => {
    log.pdg(`handleNext | group=${currentGroupIndex + 1}/${groupArray.length}`);
    // Auto-save in background — no waiting, no blocking navigation
    if (hasUnsavedChanges) handleSave();
    if (currentGroupIndex < groupArray.length - 1) {
      setCurrentGroupIndex(currentGroupIndex + 1);
    }
  };

  const handlePrevious = () => {
    log.pdg(`handlePrevious | group=${currentGroupIndex + 1}/${groupArray.length}`);
    // Auto-save in background — no waiting, no blocking navigation
    if (hasUnsavedChanges) handleSave();
    if (currentGroupIndex > 0) {
      setCurrentGroupIndex(currentGroupIndex - 1);
    }
  };

  const handleFinish = () => {
    log.pdg(`handleFinish | items=${processedItems.length}`);
    // Sync state to parent then trigger CSV download
    onProcessed(processedItems);
    onDownloadCSV?.();
  };

  // ── Crop UI state ─────────────────────────────────────────────────────────
  // IMPORTANT: All hooks must be declared before any early returns (React rules
  // of hooks). These crop refs/states are only *used* when currentItem is set,
  // but they must be unconditionally declared here.
  // ──────────────────────────────────────────────────────────────────────────
  type DragMode = 'new' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
  const cropImgRef  = useRef<HTMLImageElement | null>(null);
  const cropStageRef = useRef<HTMLDivElement | null>(null);
  // Measured after image loads — px offsets of the image from the stage top-left
  const [cropImgBounds, setCropImgBounds] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  // Set by handle/move-zone onPointerDown before event bubbles to stage
  const pendingCropModeRef = useRef<DragMode | null>(null);
  // null = free draw, otherwise w/h ratio
  const [aspectLock, setAspectLock] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<string>('FREE');
  // Drag state: 'new' = drawing fresh rect; handle = which edge/corner being dragged
  const cropDragRef = useRef<{ mode: DragMode; startX: number; startY: number; startCrop: { x: number; y: number; w: number; h: number } } | null>(null);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Measure the rendered image position relative to the stage and store in state.
  // Called via useEffect (rAF) so we always get post-paint values.
  const measureCropImg = useCallback(() => {
    if (!cropImgRef.current || !cropStageRef.current) return;
    const ir = cropImgRef.current.getBoundingClientRect();
    const sr = cropStageRef.current.getBoundingClientRect();
    if (ir.width > 0) {
      setCropImgBounds({ l: ir.left - sr.left, t: ir.top - sr.top, w: ir.width, h: ir.height });
    }
  }, []);

  // All pointer events on the stage. Mode is determined by pendingCropModeRef
  // (set by handle/move-zone before event bubbles) or defaults to 'new'.
  const handleCropPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const mode: DragMode = pendingCropModeRef.current ?? 'new';
    pendingCropModeRef.current = null;
    if (!cropImgBounds || !cropStageRef.current) return;
    // Capture on the stage — pointermove/up always route here
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const sr = cropStageRef.current.getBoundingClientRect();
    const rx = (e.clientX - sr.left - cropImgBounds.l) / cropImgBounds.w;
    const ry = (e.clientY - sr.top - cropImgBounds.t) / cropImgBounds.h;
    // Don't start a 'new' draw if clicking outside the image
    if (mode === 'new' && (rx < 0 || rx > 1 || ry < 0 || ry > 1)) return;
    cropDragRef.current = {
      mode,
      startX: rx,
      startY: ry,
      startCrop: tempCrop ? { ...tempCrop } : { x: 0, y: 0, w: 100, h: 100 },
    };
  };

  const handleCropPointerMove = (e: React.PointerEvent) => {
    const drag = cropDragRef.current;
    if (!drag || !cropImgBounds || !cropStageRef.current) return;
    const sr = cropStageRef.current.getBoundingClientRect();
    const cx = clamp((e.clientX - sr.left - cropImgBounds.l) / cropImgBounds.w, 0, 1);
    const cy = clamp((e.clientY - sr.top - cropImgBounds.t) / cropImgBounds.h, 0, 1);
    const dx = (cx - drag.startX) * 100;
    const dy = (cy - drag.startY) * 100;
    const sc = drag.startCrop;

    let { x, y, w, h } = sc;

    if (drag.mode === 'new') {
      const nx = clamp(cx * 100, 0, 100), ny = clamp(cy * 100, 0, 100);
      const sx = drag.startX * 100, sy = drag.startY * 100;
      x = Math.min(nx, sx); y = Math.min(ny, sy);
      w = Math.abs(nx - sx); h = Math.abs(ny - sy);
      if (aspectLock) {
        h = w / aspectLock;
        if (y + h > 100) { h = 100 - y; w = h * aspectLock; }
      }
    } else if (drag.mode === 'move') {
      x = clamp(sc.x + dx, 0, 100 - sc.w);
      y = clamp(sc.y + dy, 0, 100 - sc.h);
    } else {
      if (drag.mode.includes('e')) { w = clamp(sc.w + dx, 5, 100 - sc.x); }
      if (drag.mode.includes('s')) { h = clamp(sc.h + dy, 5, 100 - sc.y); }
      if (drag.mode.includes('w')) { const nx = clamp(sc.x + dx, 0, sc.x + sc.w - 5); w = sc.x + sc.w - nx; x = nx; }
      if (drag.mode.includes('n')) { const ny = clamp(sc.y + dy, 0, sc.y + sc.h - 5); h = sc.y + sc.h - ny; y = ny; }
      if (aspectLock) {
        if (Math.abs(dx) >= Math.abs(dy)) { h = w / aspectLock; }
        else { w = h * aspectLock; }
        x = clamp(x, 0, 100 - w); y = clamp(y, 0, 100 - h);
      }
    }
    x = clamp(x, 0, 100); y = clamp(y, 0, 100);
    w = clamp(w, 1, 100 - x); h = clamp(h, 1, 100 - y);
    setTempCrop({ x, y, w, h });
  };

  const handleCropPointerUp = () => { cropDragRef.current = null; };

  const CROP_PRESETS: { label: string; ratio: number | null }[] = [
    { label: 'FREE',  ratio: null },
    { label: '1:1',  ratio: 1 },
    { label: '9:16', ratio: 9 / 16 },
    { label: '16:9', ratio: 16 / 9 },
    { label: '4:5',  ratio: 4 / 5 },
    { label: '3:2',  ratio: 3 / 2 },
  ];

  const applyPreset = (label: string, ratio: number | null) => {
    setActivePreset(label);
    setAspectLock(ratio);
    if (!ratio || !cropImgBounds) return;
    const { w: cw, h: ch } = cropImgBounds;
    let pw = 1, ph = 1;
    if (cw / ch > ratio) { ph = 1; pw = ratio * ch / cw; }
    else { pw = 1; ph = (cw / ch) / ratio; }
    const left = (1 - pw) / 2, top = (1 - ph) / 2;
    setTempCrop({ x: left * 100, y: top * 100, w: pw * 100, h: ph * 100 });
  };

  // Measure the crop image after the crop UI opens (double-rAF = after paint)
  useEffect(() => {
    if (!cropModal.open) { setCropImgBounds(null); return; }
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(measureCropImg);
    });
    return () => cancelAnimationFrame(id);
  }, [cropModal.open, lightboxSrc, measureCropImg]);

  // Keyboard: close lightbox or crop modal on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cropModal.open) { setCropModal({ open: false }); setTempCrop(null); return; }
        if (lightboxSrc) closeLightbox();
      }
      if (lightboxSrc && !cropModal.open) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); navigateLightbox(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); navigateLightbox(1); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lightboxSrc, lightboxItemId, lightboxPool, cropModal.open]);

  // Guard: no items ready yet (nothing categorized)
  // NOTE: This must come AFTER all hook declarations above (React rules of hooks)
  if (!currentItem) {
    return (
      <div className="product-description-container" style={{ padding: '2rem', textAlign: 'center', color: '#888', fontSize: '0.95rem' }}>
        ⚠️ No categorized items yet — go back to Step 2 and drag items to a category zone.
      </div>
    );
  }

  // Use shared helper to create transformed file
  // helper createTransformedFile will be dynamically imported where needed

  // Upload transformed image and optionally overwrite the existing storage path
  const applyAndPersistTransform = async (itemId: string, replaceExisting = true, itemOverride?: Partial<ClothingItem>) => {
    const baseItem = processedItems.find(i => i.id === itemId);
    if (!baseItem) return;
    const item = itemOverride ? { ...baseItem, ...itemOverride } : baseItem;

    const { createTransformedFile } = await import('../lib/imageTransforms');
    const file = await createTransformedFile(item);
    if (!file) { console.error('createTransformedFile returned null for item', itemId); return; }

    try {
      const { uploadFileToPath, uploadTransformedImage } = await import('../lib/productService');
      if (replaceExisting && item.storagePath) {
        const res = await uploadFileToPath(file, item.storagePath, true);
        if (res) {
          setProcessedItems(prev => prev.map(i => i.id === itemId ? { ...i, preview: res.url, storagePath: res.path, imageRotation: 0, crop: undefined } : i));
          setHasUnsavedChanges(true);
          return;
        }
      }
      const res2 = await uploadTransformedImage(file);
      if (res2) {
        if (replaceExisting && item.storagePath) {
          try { await (await import('../lib/supabase')).supabase.storage.from('product-images').remove([item.storagePath]); } catch { /* ignore */ }
        }
        setProcessedItems(prev => prev.map(i => i.id === itemId ? { ...i, preview: res2.url, storagePath: res2.path, imageRotation: 0, crop: undefined } : i));
        setHasUnsavedChanges(true);
      }
    } catch (err) {
      console.error('applyAndPersistTransform error:', err);
    }
  };

  // ── Bulk crop paste ──────────────────────────────────────────────────────────
  // Applies copiedCrop to every item across all selected groups (or all groups if
  // none selected), batched 4 at a time so Supabase isn't overwhelmed.
  const handlePasteCrop = async (crop: { x: number; y: number; w: number; h: number }) => {
    const groupArray = buildGroupArray(processedItems);
    // Determine target groups
    let targetGroups: typeof groupArray;
    if (selectedGroupIds.size > 0) {
      targetGroups = groupArray.filter(g => g[0] && selectedGroupIds.has(g[0].id));
    } else {
      targetGroups = groupArray;
    }
    const targetItems = targetGroups.flat();
    if (targetItems.length === 0) return;

    // First: instantly set crop coordinates on all target items in state so
    // thumbnails update via CSS clip-path immediately while uploads run in bg.
    const targetIdSet = new Set(targetItems.map(i => i.id));
    setProcessedItems(prev => prev.map(i =>
      targetIdSet.has(i.id) ? { ...i, crop } : i
    ));
    setHasUnsavedChanges(true);

    // Then: bake + upload in batches of 4 so Supabase isn't overloaded
    const CONCURRENCY = 4;
    setCropPasteProgress({ done: 0, total: targetItems.length });
    let done = 0;
    for (let i = 0; i < targetItems.length; i += CONCURRENCY) {
      const batch = targetItems.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(item => applyAndPersistTransform(item.id, true, { crop })));
      done += batch.length;
      setCropPasteProgress({ done, total: targetItems.length });
      // Small breathing room between batches to avoid rate-limit
      if (i + CONCURRENCY < targetItems.length) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    setCropPasteProgress(null);
    if (selectedGroupIds.size > 0) setSelectedGroupIds(new Set());
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
          {/* Scrollable area — image, thumbnails, magnifier controls. Height varies; nav buttons below stay fixed. */}
          <div className="preview-scroll-area">
          <div
            className="preview-image-wrap"
            ref={mainPreviewRef}
            onMouseMove={(e) => {
              if (!magnifierSettings.enabled) return;
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
              loading="eager"
              className="preview-image"
              style={{ cursor: 'zoom-in', transform: `rotate(${currentItem.imageRotation || 0}deg)`, clipPath: currentItem.crop ? `inset(${currentItem.crop.y}% ${100 - (currentItem.crop.x + currentItem.crop.w)}% ${100 - (currentItem.crop.y + currentItem.crop.h)}% ${currentItem.crop.x}%)` : undefined }}
              onDoubleClick={() => openLightbox(currentItem.preview || currentItem.imageUrls?.[0] || '', currentItem.id, currentGroup.map(i => i.id))}
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
                    onDoubleClick={() => openLightbox(groupItem.preview || groupItem.imageUrls?.[0] || '', groupItem.id, currentGroup.map(i => i.id))}
                    onMouseMove={(e) => {
                      if (!magnifierSettings.enabled) return;
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const xPct = (e.clientX - rect.left) / rect.width;
                      const yPct = (e.clientY - rect.top) / rect.height;
                      setMagnifier({
                        src: groupItem.preview || groupItem.imageUrls?.[0] || '',
                        x: e.clientX,
                        y: e.clientY,
                        bgX: xPct * 100,
                        bgY: yPct * 100,
                      });
                    }}
                    onMouseLeave={() => setMagnifier(null)}
                    title={`Image ${idx + 1} — double-click to expand`}
                  >
                    <LazyImg
                      src={groupItem.preview || groupItem.imageUrls?.[0] || ''}
                      alt={`Image ${idx + 1}`}
                      loading="eager"
                      className="group-thumbnail"
                      style={{ transform: `rotate(${groupItem.imageRotation || 0}deg)`, clipPath: groupItem.crop ? `inset(${groupItem.crop.y}% ${100 - (groupItem.crop.x + groupItem.crop.w)}% ${100 - (groupItem.crop.y + groupItem.crop.h)}% ${groupItem.crop.x}%)` : undefined }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Magnifier settings controls */}
          <div className="magnifier-controls">
            <span className="magnifier-controls-label">🔍 Magnifier</span>
            <label className="magnifier-toggle">
              <input
                type="checkbox"
                checked={magnifierSettings.enabled}
                onChange={(e) => { setMagnifier(null); updateMagnifierSettings({ enabled: e.target.checked }); }}
              />
              <span>{magnifierSettings.enabled ? 'On' : 'Off'}</span>
            </label>
            <label className="magnifier-slider-label">
              Size
              <input
                type="range"
                min={160}
                max={520}
                step={40}
                value={magnifierSettings.size}
                disabled={!magnifierSettings.enabled}
                onChange={(e) => updateMagnifierSettings({ size: Number(e.target.value) })}
              />
              <span className="magnifier-slider-value">{magnifierSettings.size}px</span>
            </label>
            <label className="magnifier-slider-label">
              Zoom
              <input
                type="range"
                min={2}
                max={10}
                step={1}
                value={magnifierSettings.zoom}
                disabled={!magnifierSettings.enabled}
                onChange={(e) => updateMagnifierSettings({ zoom: Number(e.target.value) })}
              />
              <span className="magnifier-slider-value">{magnifierSettings.zoom}×</span>
            </label>
          </div>
          </div>{/* end preview-scroll-area */}

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
              {/* Format painter — copy/paste structured fields */}
              <button
                className="button button-secondary"
                title="Copy all structured fields (brand, size, color…) from this item"
                onClick={() => {
                  setCopiedFields({
                    brand: currentItem.brand,
                    color: currentItem.color,
                    secondaryColor: currentItem.secondaryColor,
                    size: currentItem.size,
                    material: currentItem.material,
                    condition: currentItem.condition,
                    era: currentItem.era,
                    style: currentItem.style,
                    gender: currentItem.gender,
                    price: currentItem.price,
                    flaws: currentItem.flaws,
                    care: currentItem.care,
                    measurements: currentItem.measurements,
                    tags: currentItem.tags,
                  });
                }}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
              >
                🖌️ Copy Fields
              </button>
              {copiedFields && (
                <button
                  className="button"
                  title="Paste copied fields onto this item"
                  onClick={() => {
                    const targetIds = new Set(currentGroup.map(g => g.id));
                    setProcessedItems(prev => prev.map(item =>
                      targetIds.has(item.id) ? { ...item, ...copiedFields } : item
                    ));
                  }}
                  style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem', background: '#6366f1' }}
                >
                  📋 Paste Fields
                </button>
              )}
              {copiedCrop && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  {cropPasteProgress ? (
                    <span style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>
                      ⏳ {cropPasteProgress.done}/{cropPasteProgress.total} cropping…
                    </span>
                  ) : (
                    <>
                      <button
                        className="button"
                        title={selectedGroupIds.size > 0
                          ? `Paste crop to ${selectedGroupIds.size} selected group(s)`
                          : 'Paste crop to ALL groups — select groups first to limit scope'}
                        onClick={() => handlePasteCrop(copiedCrop)}
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem', background: '#0ea5e9' }}
                      >
                        📐 Paste Crop{selectedGroupIds.size > 0 ? ` (${selectedGroupIds.size})` : ' (All)'}
                      </button>
                      <button
                        title="Clear copied crop"
                        onClick={() => setCopiedCrop(null)}
                        style={{ fontSize: '0.8rem', background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: '0.1rem 0.3rem' }}
                      >✕</button>
                    </>
                  )}
                </div>
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
              {/* Mode toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label><strong>Voice Description</strong> <span style={{ fontWeight: 400, color: '#64748b', fontSize: '0.85em' }}>— say <em>field name → value → "period"</em> to apply (e.g. <em>"brand Nike period"</em>)</span></label>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    title="Clear all voice fields"
                    onClick={() => {
                      const updated = [...processedItems];
                      currentGroup.forEach(groupItem => {
                        const idx = updated.findIndex(i => i.id === groupItem.id);
                        if (idx !== -1) {
                          updated[idx] = {
                            ...updated[idx],
                            brand: '', color: '', secondaryColor: '', size: '',
                            material: '', condition: undefined, era: '', style: '',
                            gender: undefined, price: undefined, flaws: '', care: '',
                            modelName: '', tags: [], measurements: {},
                            voiceDescription: '',
                          };
                        }
                      });
                      setProcessedItems(updated);
                    }}
                    style={{
                      padding: '0.2rem 0.55rem',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      border: '1px solid #fca5a5',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      background: '#fff5f5',
                      color: '#dc2626',
                      transition: 'all 0.15s',
                    }}
                  >
                    🗑 Clear Fields
                  </button>
                  <div style={{ display: 'flex', gap: 0, borderRadius: '6px', overflow: 'hidden', border: '1px solid #d1d5db' }}>
                    {(['table', 'text'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setVoiceMode(mode)}
                        style={{
                          padding: '0.2rem 0.7rem',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          border: 'none',
                          cursor: 'pointer',
                          background: voiceMode === mode ? '#6366f1' : '#f9fafb',
                          color: voiceMode === mode ? '#fff' : '#374151',
                          transition: 'all 0.15s',
                        }}
                      >
                        {mode === 'table' ? '⊞ Table' : '≡ Text'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {voiceMode === 'table' ? (
                <VoiceCommandTable
                  currentItem={currentItem}
                  isRecording={isRecording}
                  activeField={activeVoiceField}
                  interimValue={interimTranscript}
                  onChange={handleTableFieldChange}
                />
              ) : (
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
                      ['width', '18"'],
                      ['length', '28"'],
                      ['waist', '32"'],
                      ['inseam', '30"'],
                      ['outseam', '40"'],
                      ['leg opening', '18"'],
                      ['title', 'vintage tee'],
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
                    value={currentItem.voiceDescription || interimTranscript || ''}
                    onChange={(e) => {
                      setInterimTranscript('');
                      const newText = e.target.value;
                      const updated = [...processedItems];

                      // Parse "field value period" commands from the text and apply to item fields
                      const parseVoiceTextToFields = (text: string): Partial<ClothingItem> & { measurements?: any } => {
                        const fields: any = {};
                        const normalized = text.replace(/\.(?=\s|$)/g, ' period').replace(/\n/g, ' ');
                        const MEAS_KEYWORDS = 'brand|model|size|colou?r|secondary|second|accent|material|fabric|condition|era|style|gender|price|flaws?|care|width|length|waist|shoulder|sleeve|inseam|outseam|chest|hip|rise|leg|tags?|title';
                        const BOUNDARY_RE = new RegExp(`^(.*?)\\b(?:${MEAS_KEYWORDS})\\s+\\w`, 'i');

                        const grab = (pattern: RegExp) => {
                          const m = normalized.match(pattern);
                          if (!m) return null;
                          const val = m[1].trim();
                          const b = val.match(BOUNDARY_RE);
                          return b ? (b[1].trim() || null) : val;
                        };

                        // Standard: requires spoken "period" as terminator
                        const v = (label: string) => grab(new RegExp(`\\b${label}\\s+(.+?)\\s+period\\b`, 'i'));

                        // Measurement-specific: captures a number (with optional decimal/fraction)
                        // after a label WITHOUT requiring "period" — works even at end of transcript.
                        // Strips trailing units (inches, inch, in) automatically.
                        const measV = (label: string): string | null => {
                          // Try period-terminated first (most reliable)
                          const withPeriod = v(label);
                          if (withPeriod) return withPeriod.replace(/[^0-9.]/g, '');
                          // Then try: LABEL NUMBER (units?) terminated by next keyword or end-of-string
                          const re = new RegExp(
                            `\\b${label}\\s+(\\d+(?:\\.\\d+)?)\\s*(?:inches?|in\\.)?\\s*(?=\\b(?:${MEAS_KEYWORDS})\\b|$)`,
                            'i'
                          );
                          const m = normalized.match(re);
                          if (m) return m[1];
                          // Last fallback: LABEL followed by any number anywhere before a keyword
                          const re2 = new RegExp(`\\b${label}\\s+(\\d+(?:\\.\\d+)?)`, 'i');
                          const m2 = normalized.match(re2);
                          return m2 ? m2[1] : null;
                        };

                        const b = v('brand');      if (b) fields.brand = b;
                        const s = v('size');       if (s) fields.size = s;
                        const col = v('colou?r');  if (col) { const p = col.split(/\s+and\s+|\s*\/\s*/i); fields.color = p[0]; if (p[1]) fields.secondaryColor = p[1]; }
                        const sc = v('second(?:\\s+colou?r|ary\\s+colou?r)'); if (sc) fields.secondaryColor = sc;
                        const cond = v('condition'); if (cond) fields.condition = cond;
                        const pr = v('price');     if (pr) { const n = pr.replace(/[^0-9.]/g,''); if (n) fields.price = parseFloat(n); }
                        const er = v('era');       if (er) fields.era = er;
                        const st = v('style');     if (st) fields.style = st;
                        const ge = v('gender');    if (ge) fields.gender = ge;
                        const ma = v('(?:material|fabric)'); if (ma) fields.material = ma;
                        const ta = v('tags?');     if (ta) fields.tags = ta.split(/,\s*/).filter(Boolean);
                        const fl = v('flaws?');    if (fl) fields.flaws = fl;
                        const ca = v('care');      if (ca) fields.care = ca;
                        const ti = v('title');     if (ti) fields.seoTitle = ti;

                        const meas: any = {};
                        const mch = measV('chest');          if (mch) meas.chest = mch;
                        const mw  = measV('width');          if (mw)  meas.width = mw;
                        const ml  = measV('length');         if (ml)  meas.length = ml;
                        const mwa = measV('waist');          if (mwa) meas.waist = mwa;
                        const mhi = measV('hip');            if (mhi) meas.hip = mhi;
                        const mri = measV('rise');           if (mri) meas.rise = mri;
                        const mi  = measV('inseam');         if (mi)  meas.inseam = mi;
                        const mo  = measV('outseam');        if (mo)  meas.outseam = mo;
                        const mleg = measV('leg\\s+opening'); if (mleg) meas.leg_opening = mleg;
                        const msl = measV('sleeve');         if (msl) meas.sleeve = msl;
                        const msh = measV('shoulder');       if (msh) meas.shoulder = msh;
                        if (Object.keys(meas).length) fields.measurements = meas;
                        return fields;
                      };

                      const parsedFields = parseVoiceTextToFields(newText);

                      currentGroup.forEach(groupItem => {
                        const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                        if (itemIndex !== -1) {
                          const { measurements: parsedMeas, ...flatFields } = parsedFields;
                          updated[itemIndex] = {
                            ...updated[itemIndex],
                            ...flatFields,
                            measurements: parsedMeas
                              ? { ...(updated[itemIndex].measurements || {}), ...parsedMeas }
                              : updated[itemIndex].measurements,
                            voiceDescription: newText,
                          };
                        }
                      });
                      setProcessedItems(updated);
                    }}
                    placeholder={"Start Recording and speak...\n\nExample (say measurements without needing 'period'):\n  chest 38 waist 32 sleeve 25\n  color black period brand Nike period"}
                    rows={8}
                    className="description-textarea"
                    style={{ flex: 1, minWidth: 0 }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
              )}
            </div>

            {/* Title — editable above the AI description */}
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 600, marginBottom: '0.4rem' }}>
                <span>Title:</span>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 400,
                  color: (currentItem.seoTitle || '').length > 60 ? '#dc2626' : (currentItem.seoTitle || '').length > 50 ? '#d97706' : '#6b7280'
                }}>
                  {(currentItem.seoTitle || '').length} / 60
                </span>
              </label>
              <input
                type="text"
                value={currentItem.seoTitle || ''}
                onChange={(e) => {
                  const updated = [...processedItems];
                  currentGroup.forEach(groupItem => {
                    const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                    if (itemIndex !== -1) {
                      updated[itemIndex].seoTitle = e.target.value;
                    }
                  });
                  setProcessedItems(updated);
                }}
                placeholder={(() => {
                  // Build a live preview from current fields as placeholder
                  const clean = (s?: string) => (s || '').replace(/\bperiod\b/gi, '').replace(/\s{2,}/g, ' ').trim();
                  const parts = [
                    clean(currentItem.brand),
                    clean(currentItem.era),
                    clean(currentItem.style),
                    clean(currentItem.color),
                    clean(currentItem.category),
                    currentItem.size ? `(${clean(currentItem.size)})` : '',
                  ].filter(Boolean);
                  const preview = parts.join(' ');
                  if (!preview) return 'Will be generated from Brand, Era, Color, Category…';
                  const trimmed = preview.length > 60
                    ? preview.split(' ').reduce((acc, w) => {
                        const next = acc ? `${acc} ${w}` : w;
                        return next.length > 60 ? acc : next;
                      }, '')
                    : preview;
                  return trimmed || preview.slice(0, 60);
                })()}
                className="info-input"
                style={{ width: '100%' }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              {!currentItem.seoTitle && (
                <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
                  Preview from current fields — type to override, or hit Generate to lock it in
                </p>
              )}
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
                      updated[itemIndex].descriptionEdited = true;
                    }
                  });
                  setProcessedItems(updated);
                }}
                className="info-textarea"
                rows={6}
                style={{ width: '100%' }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  className="button button-primary"
                  onClick={() => handleRegenerateAll()}
                  disabled={isGenerating || isSyncingFields || isSyncingFromVoice}
                  style={{
                    flex: 1,
                    background: isGenerating
                      ? 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'
                      : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  }}
                  title="Re-extract all fields from voice + description, then regenerate AI description"
                >
                  {isGenerating ? '🧠 Regenerating…' : '🔄 Regenerate AI Description'}
                </button>
                <button
                  className="button"
                  onClick={() => {
                    const updated = [...processedItems];
                    currentGroup.forEach(groupItem => {
                      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                      if (itemIndex !== -1) {
                        updated[itemIndex].generatedDescription = '';
                        updated[itemIndex].seoDescription = '';
                        updated[itemIndex].descriptionEdited = false;
                      }
                    });
                    setProcessedItems(updated);
                  }}
                  title="Clear the AI generated description"
                  style={{
                    background: 'transparent',
                    border: '1px solid #d1d5db',
                    color: '#6b7280',
                    padding: '0 0.75rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  🗑 Clear
                </button>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.35rem', marginBottom: 0 }}>
                Reads voice &amp; description → updates all fields → writes new AI description
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
                {/* Searchable preset combobox */}
                <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center',
                      border: `1px solid ${presetSearchOpen ? '#6366f1' : '#ced4da'}`,
                      borderRadius: '4px', background: 'white',
                      boxShadow: presetSearchOpen ? '0 0 0 2px #e0e7ff' : 'none',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                  >
                    <span style={{ padding: '0 0.5rem', color: '#9ca3af', fontSize: '0.9rem' }}>🔍</span>
                    <input
                      type="text"
                      placeholder={
                        currentItem._presetData ? `Keep Current: ${currentItem._presetData.displayName}` : 'Search presets…'
                      }
                      value={presetSearchOpen ? presetSearchQuery : appliedPresetLabel}
                      onFocus={() => { setPresetSearchQuery(''); setPresetSearchOpen(true); }}
                      onChange={e => { setPresetSearchQuery(e.target.value); setPresetSearchOpen(true); }}
                      onBlur={() => setTimeout(() => setPresetSearchOpen(false), 150)}
                      onKeyDown={e => e.stopPropagation()}
                      style={{
                        flex: 1, border: 'none', outline: 'none',
                        padding: '0.5rem 0.25rem', fontSize: '0.95rem', background: 'transparent',
                        color: !presetSearchOpen && appliedPresetLabel ? '#4f46e5' : '#1f2937',
                        fontWeight: !presetSearchOpen && appliedPresetLabel ? 600 : 400,
                      }}
                    />
                    {(presetSearchQuery || appliedPresetLabel) && (
                      <button
                        onMouseDown={e => { e.preventDefault(); setPresetSearchQuery(''); setAppliedPresetLabel(''); setPresetSearchOpen(true); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.5rem', color: '#9ca3af', fontSize: '1rem', lineHeight: 1 }}
                      >✕</button>
                    )}
                  </div>

                  {presetSearchOpen && (() => {
                    const normSearch = (s: string) => s.toLowerCase().replace(/['’\-.,]/g, '');
                    const q = normSearch(presetSearchQuery);
                    const filtered = [
                      ...(currentItem._presetData ? [{ id: '', label: `Keep Current: ${currentItem._presetData.displayName}`, sub: '' }] : [{ id: '', label: 'Keep current / no change', sub: '' }]),
                      ...availablePresets
                        .filter(p =>
                          !q ||
                          normSearch(p.display_name).includes(q) ||
                          normSearch(p.product_type || '').includes(q) ||
                          normSearch(p.category_name || '').includes(q)
                        )
                        .map(p => ({ id: p.id, label: p.display_name + (p.is_default ? ' ✓' : ''), sub: p.product_type || '' }))
                    ];
                    return (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0,
                        background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200,
                        maxHeight: '240px', overflowY: 'auto',
                      }}>
                        {filtered.length === 0 && (
                          <div style={{ padding: '0.6rem 0.9rem', color: '#9ca3af', fontSize: '0.85rem' }}>No presets match</div>
                        )}
                        {filtered.map(opt => (
                          <div
                            key={opt.id}
                            onMouseDown={e => {
                              e.preventDefault();
                              setAppliedPresetLabel(opt.label);
                              setPresetSearchQuery('');
                              setPresetSearchOpen(false);
                              handleApplyPreset(opt.id);
                            }}
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '0.45rem 0.9rem', cursor: 'pointer', fontSize: '0.9rem',
                              background: opt.id === selectedPresetId ? '#eef2ff' : 'white',
                              color: opt.id === selectedPresetId ? '#4f46e5' : '#1f2937',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f5f7ff')}
                            onMouseLeave={e => (e.currentTarget.style.background = opt.id === selectedPresetId ? '#eef2ff' : 'white')}
                          >
                            <span>{opt.label}</span>
                            {opt.sub && <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{opt.sub}</span>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
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
      {magnifier && magnifierSettings.enabled && (
        <div
          className="magnifier-lens"
          style={{
            width: magnifierSettings.size,
            height: magnifierSettings.size,
            left: magnifier.x + 20,
            top: magnifier.y,
            backgroundImage: `url(${magnifier.src})`,
            backgroundPosition: `${magnifier.bgX}% ${magnifier.bgY}%`,
            backgroundSize: `${magnifierSettings.zoom * 100}%`,
          }}
        />
      )}

      {/* Lightbox — double-click opens; rotate + crop toolbar; nav arrows */}
      {lightboxSrc && (() => {
        const lbItem = processedItems.find(i => i.id === lightboxItemId) ?? null;
        const canNav = lightboxPool.length > 1;
        const cropping = cropModal.open;
        return (
          <div className="lightbox-overlay" onClick={!cropping ? closeLightbox : undefined}>
            {/* Everything below is hidden while crop is active */}
            {!cropping && <>
              <button className="lightbox-close-standalone" onClick={closeLightbox} title="Close">✕</button>
              {canNav && <button className="lightbox-nav lightbox-nav-left" onClick={(e) => { e.stopPropagation(); navigateLightbox(-1); }}>‹</button>}
              {canNav && <button className="lightbox-nav lightbox-nav-right" onClick={(e) => { e.stopPropagation(); navigateLightbox(1); }}>›</button>}
              <div className="lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
                {lbItem && (<>
                  <button className="lightbox-tool-btn" title="Rotate left"
                    onClick={() => { const u = processedItems.map(i => i.id === lbItem.id ? { ...i, imageRotation: ((i.imageRotation || 0) - 90) % 360 } : i); setProcessedItems(u); setHasUnsavedChanges(true); }}>⟲ Rotate L</button>
                  <button className="lightbox-tool-btn" title="Rotate right"
                    onClick={() => { const u = processedItems.map(i => i.id === lbItem.id ? { ...i, imageRotation: ((i.imageRotation || 0) + 90) % 360 } : i); setProcessedItems(u); setHasUnsavedChanges(true); }}>⟳ Rotate R</button>
                  <button className="lightbox-tool-btn" title="Crop image"
                    onClick={() => { setCropModal({ open: true, itemId: lbItem.id }); setActivePreset('FREE'); setAspectLock(null); setTempCrop({ x: 5, y: 5, w: 90, h: 90 }); }}>✂ Crop</button>
                </>)}
              </div>
              <img src={lightboxSrc} alt="Full size preview" className="lightbox-image"
                style={{ transform: lbItem ? `rotate(${lbItem.imageRotation || 0}deg)` : undefined }}
                onClick={(e) => e.stopPropagation()} />
              {canNav && <span className="lightbox-counter">{lightboxPool.indexOf(lightboxItemId!) + 1} / {lightboxPool.length}</span>}
            </>}

            {/* Crop UI — absolutely fills the lightbox overlay */}
            {cropping && (() => {
              const cropItem = processedItems.find(i => i.id === cropModal.itemId);
              const imgSrc = lightboxSrc || cropItem?.preview || cropItem?.imageUrls?.[0] || '';
              const rot = cropItem?.imageRotation || 0;
              return (
                <div className="crop-fullscreen" onClick={(e) => e.stopPropagation()}>
                  <div className="crop-fs-topbar">
                    <button className="crop-fs-btn crop-fs-cancel" onClick={() => { setCropModal({ open: false }); setTempCrop(null); setActivePreset('FREE'); setAspectLock(null); }}>Cancel</button>
                    <span className="crop-fs-title">Crop</span>
                    <button className="crop-fs-btn" disabled={!tempCrop}
                      title="Copy crop coordinates so you can paste to other items"
                      style={{ background: tempCrop ? '#6366f1' : undefined, color: '#fff', opacity: tempCrop ? 1 : 0.4 }}
                      onClick={() => { if (tempCrop) { setCopiedCrop(tempCrop); } }}>
                      📐 Copy Crop
                    </button>
                    <button className="crop-fs-btn crop-fs-done" disabled={!tempCrop} onClick={async () => {
                      if (!cropModal.itemId || !tempCrop) return;
                      await applyAndPersistTransform(cropModal.itemId, true, { crop: tempCrop });
                      setCropModal({ open: false }); setTempCrop(null); setActivePreset('FREE'); setAspectLock(null);
                      closeLightbox();
                    }}>Done</button>
                  </div>
                  {/* Stage: position:relative, owns the coordinate space for all overlay elements */}
                  <div className="crop-fs-stage" ref={cropStageRef}
                    onPointerDown={handleCropPointerDown}
                    onPointerMove={handleCropPointerMove}
                    onPointerUp={handleCropPointerUp}
                  >
                    {/* Image — centered by flex, passive (no pointer events) */}
                    <div className="crop-fs-img-wrap">
                      <img ref={cropImgRef} src={imgSrc} alt="Crop target" className="crop-fs-image"
                        style={{ transform: `rotate(${rot}deg)`, maxHeight: 'calc(100vh - 120px)' }} draggable={false}
                        onLoad={measureCropImg} />
                    </div>
                    {/* Overlay elements — absolutely positioned on stage in real px (never %) */}
                    {tempCrop && cropImgBounds && (() => {
                      const { l: iL, t: iT, w: iW, h: iH } = cropImgBounds;
                      const rx = iL + tempCrop.x / 100 * iW;
                      const ry = iT + tempCrop.y / 100 * iH;
                      const rw = tempCrop.w / 100 * iW;
                      const rh = tempCrop.h / 100 * iH;
                      return (<>
                        {/* 4 dark panels surrounding the crop box */}
                        <div className="crop-fs-mask" style={{ top: iT, left: iL, width: iW, height: tempCrop.y / 100 * iH }} />
                        <div className="crop-fs-mask" style={{ top: ry + rh, left: iL, width: iW, height: iH - (tempCrop.y + tempCrop.h) / 100 * iH }} />
                        <div className="crop-fs-mask" style={{ top: ry, left: iL, width: tempCrop.x / 100 * iW, height: rh }} />
                        <div className="crop-fs-mask" style={{ top: ry, left: rx + rw, width: iW - (tempCrop.x + tempCrop.w) / 100 * iW, height: rh }} />
                        {/* Crop selection box — dashed border, with grid + handles inside */}
                        <div className="crop-fs-rect" style={{ left: rx, top: ry, width: rw, height: rh }}>
                          {/* Move zone: covers interior, sets pending mode before bubbling to stage */}
                          <div className="crop-fs-move-zone"
                            onPointerDown={() => { pendingCropModeRef.current = 'move'; }} />
                          <div className="crop-fs-grid-h" style={{ top: '33.33%' }} />
                          <div className="crop-fs-grid-h" style={{ top: '66.66%' }} />
                          <div className="crop-fs-grid-v" style={{ left: '33.33%' }} />
                          <div className="crop-fs-grid-v" style={{ left: '66.66%' }} />
                          {(['nw','ne','sw','se'] as const).map(hh => (
                            <div key={hh} className={`crop-fs-handle crop-fs-corner crop-fs-corner-${hh}`}
                              onPointerDown={() => { pendingCropModeRef.current = hh; }} />
                          ))}
                          {(['n','s','e','w'] as const).map(hh => (
                            <div key={hh} className={`crop-fs-handle crop-fs-edge crop-fs-edge-${hh}`}
                              onPointerDown={() => { pendingCropModeRef.current = hh; }} />
                          ))}
                        </div>
                      </>);
                    })()}
                  </div>
                  <div className="crop-fs-ratiobar">
                    {CROP_PRESETS.map(({ label, ratio }) => (
                      <button key={label} className={`crop-fs-pill${activePreset === label ? ' crop-fs-pill--active' : ''}`}
                        onClick={() => applyPreset(label, ratio)}>{label}</button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}
    </div>
  );
};

export default ProductDescriptionGenerator;
