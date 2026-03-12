import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react';
import type { ClothingItem } from '../App';
import { Target } from 'lucide-react';
import { ComprehensiveProductForm } from './ComprehensiveProductForm';
import { getCategoryPresets } from '../lib/categoryPresetsService';
import type { CategoryPreset } from '../lib/categoryPresets';
import { applyPresetToProductGroup } from '../lib/applyPresetToGroup';
import { generateProductDescription } from '../lib/textAIService';
import './ProductDescriptionGenerator.css';

interface ProductDescriptionGeneratorProps {
  items: ClothingItem[];
  onProcessed: (items: ClothingItem[]) => void;
  exportBar?: ReactNode;
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
  exportBar,
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

  // Photo reorder drag state (Step 4 thumbnails)
  const [draggedThumbId, setDraggedThumbId] = useState<string | null>(null);
  const [dragOverThumbId, setDragOverThumbId] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const isStartingRef = useRef(false);
  const lastClickTimeRef = useRef(0);
  const buttonStateTransitionRef = useRef(0);
  const hasMountedRef = useRef(false); // Track if component has mounted
  const previousItemsLengthRef = useRef(0); // Track items array length for batch changes
  // Always-current mirror of processedItems so async effects never read stale state
  const processedItemsRef = useRef<ClothingItem[]>(items);
  useEffect(() => { processedItemsRef.current = processedItems; }, [processedItems]);
  // Always-current ref for onProcessed to avoid stale closures without adding it to deps
  const onProcessedRef = useRef(onProcessed);
  useEffect(() => { onProcessedRef.current = onProcessed; }, [onProcessed]);

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
    
    // Subsequent updates - sync to parent via ref so onProcessed is never a dependency
    onProcessedRef.current(processedItems);
  }, [processedItems]); // intentionally omit onProcessed — use ref instead

  // Update local state when items prop changes (e.g., opening a different batch)
  // Reset on length change (new batch), or merge in category/_presetData changes
  useEffect(() => {
    const lengthChanged = items.length !== previousItemsLengthRef.current;

    if (lengthChanged) {
      setProcessedItems(items);
      setCurrentGroupIndex(0); // Reset to first group
      previousItemsLengthRef.current = items.length;
      return;
    }

    // Even when length is the same, propagate category + _presetData from parent
    // (happens when user drags a group to a category in Step 2)
    const hasCategoryChange = items.some(incomingItem => {
      const localItem = processedItems.find(p => p.id === incomingItem.id);
      return incomingItem.category && incomingItem.category !== localItem?.category;
    });

    if (hasCategoryChange) {
      setProcessedItems(prev => prev.map(prevItem => {
        const incoming = items.find(i => i.id === prevItem.id);
        if (!incoming) return prevItem;
        if (!incoming.category || incoming.category === prevItem.category) return prevItem;

        // The incoming item is fully enriched by applyPresetToProductGroup.
        // Spread ALL incoming fields first (all preset values), then overlay
        // any field the user has already typed locally (non-empty local wins).
        return {
          ...incoming,                                                            // all preset-enriched fields
          voiceDescription:        prevItem.voiceDescription,                    // always keep local voice
          generatedDescription:    prevItem.generatedDescription || incoming.generatedDescription,
          // ── Fields user may have manually typed — local non-empty value wins ──
          seoTitle:                prevItem.seoTitle             || incoming.seoTitle,
          brand:                   prevItem.brand                || incoming.brand,
          productType:             prevItem.productType          || incoming.productType,
          price:                   prevItem.price                || incoming.price,
          compareAtPrice:          prevItem.compareAtPrice       || incoming.compareAtPrice,
          costPerItem:             prevItem.costPerItem          || incoming.costPerItem,
          color:                   prevItem.color                || incoming.color,
          secondaryColor:          prevItem.secondaryColor       || incoming.secondaryColor,
          size:                    prevItem.size                 || incoming.size,
          material:                prevItem.material             || incoming.material,
          condition:               prevItem.condition            || incoming.condition,
          flaws:                   prevItem.flaws                || incoming.flaws,
          era:                     prevItem.era                  || incoming.era,
          style:                   prevItem.style                || incoming.style,
          gender:                  prevItem.gender               || incoming.gender,
          ageGroup:                prevItem.ageGroup             || incoming.ageGroup,
          sizeType:                prevItem.sizeType             || incoming.sizeType,
          care:                    prevItem.care                 || incoming.care,
          modelName:               prevItem.modelName            || incoming.modelName,
          modelNumber:             prevItem.modelNumber          || incoming.modelNumber,
          sku:                     prevItem.sku                  || incoming.sku,
          barcode:                 prevItem.barcode              || incoming.barcode,
          weightValue:             prevItem.weightValue          || incoming.weightValue,
          inventoryQuantity:       prevItem.inventoryQuantity    || incoming.inventoryQuantity,
          shipsFrom:               prevItem.shipsFrom            || incoming.shipsFrom,
          parcelSize:              prevItem.parcelSize           || incoming.parcelSize,
          tags:                    prevItem.tags?.length         ? prevItem.tags : incoming.tags,
          // Measurements: merge field-by-field so user entries survive
          measurements: {
            ...incoming.measurements,
            width:    prevItem.measurements?.width    || incoming.measurements?.width,
            length:   prevItem.measurements?.length   || incoming.measurements?.length,
            sleeve:   prevItem.measurements?.sleeve   || incoming.measurements?.sleeve,
            shoulder: prevItem.measurements?.shoulder || incoming.measurements?.shoulder,
            waist:    prevItem.measurements?.waist    || incoming.measurements?.waist,
            inseam:   prevItem.measurements?.inseam   || incoming.measurements?.inseam,
            rise:     prevItem.measurements?.rise     || incoming.measurements?.rise,
          },
        };
      }));
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Convert spoken punctuation words into actual punctuation marks.
    // Handles: "period" → ".", "comma" → ",", "question mark" → "?",
    //          "exclamation point" → "!", "new line" / "new paragraph" → "\n"
    // The word boundary check prevents false positives (e.g. "Imperial").
    const normalizeVoicePunctuation = (text: string): string => {
      return text
        // "period" → "." — must be a standalone word (not inside another word)
        .replace(/\bperiod\b\.?/gi, '.')
        // collapse any spaces that appear right before the inserted "."
        .replace(/\s+\./g, '.')
        // optional common extras
        .replace(/\bcomma\b/gi, ',')
        .replace(/\bquestion mark\b/gi, '?')
        .replace(/\bexclamation point\b/gi, '!')
        .replace(/\bnew (line|paragraph)\b/gi, '\n')
        // tidy up: remove spaces before punctuation introduced above
        .replace(/ ([,?!])/g, '$1')
        .trim();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      // Convert spoken punctuation words before storing
      if (final) final = normalizeVoicePunctuation(final);

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
              // Ensure a space between existing description and new chunk
              // (the Web Speech API emits separate final results when you pause,
              //  so we must add the separator ourselves)
              const separator = currentDescription && !currentDescription.endsWith(' ') ? ' ' : '';
              updated[itemIndex] = {
                ...updated[itemIndex],
                voiceDescription: (currentDescription + separator + final).trim()
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

  // Apply presets to ALL groups whenever presets load or item count changes.
  // Uses processedItemsRef so the async callback always reads fresh state.
  useEffect(() => {
    if (availablePresets.length === 0) return;

    const runAsync = async () => {
      const current = processedItemsRef.current;

      const productGroups = current.reduce((groups, item) => {
        const groupId = item.productGroup || item.id;
        if (!groups[groupId]) groups[groupId] = [];
        groups[groupId].push(item);
        return groups;
      }, {} as Record<string, ClothingItem[]>);

      let hasChanges = false;
      const updatedItems = [...current];

      for (const [, groupItems] of Object.entries(productGroups)) {
        const firstItem = groupItems[0];
        if (!firstItem.category) continue;

        // Skip only if _presetData already set for this exact category on every item
        const alreadyApplied = groupItems.every(item =>
          item._presetData?.productType?.toLowerCase() === firstItem.category!.toLowerCase()
        );
        if (alreadyApplied) continue;

        try {
          const updatedGroup = await applyPresetToProductGroup(groupItems, firstItem.category);
          updatedGroup.forEach((updatedItem) => {
            const idx = updatedItems.findIndex(i => i.id === updatedItem.id);
            if (idx !== -1) { updatedItems[idx] = updatedItem; hasChanges = true; }
          });
        } catch (err) {
          console.error('Preset apply error for group:', firstItem.category, err);
        }
      }

      if (hasChanges) {
        setProcessedItems(updatedItems);
      }
    };

    runAsync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availablePresets, processedItems.length]);

  // Auto-apply default preset when navigating to a new group (currentGroupIndex changes)
  useEffect(() => {
    if (availablePresets.length === 0 || !currentItem || !currentItem.category) return;

    // Skip only if _presetData already matches this exact category for every item in group
    const alreadyApplied = currentGroup.every(item =>
      item._presetData?.productType?.toLowerCase() === currentItem.category!.toLowerCase()
    );
    if (alreadyApplied) {
      const defaultPreset = availablePresets.find(p =>
        (p.product_type?.toLowerCase() === currentItem.category?.toLowerCase() ||
          p.category_name.toLowerCase() === currentItem.category?.toLowerCase()) &&
        p.is_default && p.is_active
      );
      if (defaultPreset) setSelectedPresetId(defaultPreset.id);
      return;
    }

    const runAsync = async () => {
      try {
        const updatedGroup = await applyPresetToProductGroup(currentGroup, currentItem.category!);

        setProcessedItems(prev => {
          const updated = [...prev];
          updatedGroup.forEach((updatedItem) => {
            const idx = updated.findIndex(i => i.id === updatedItem.id);
            if (idx !== -1) updated[idx] = updatedItem;
          });
          return updated;
        });

        const defaultPreset = availablePresets.find(p =>
          (p.product_type?.toLowerCase() === currentItem.category?.toLowerCase() ||
            p.category_name.toLowerCase() === currentItem.category?.toLowerCase()) &&
          p.is_default && p.is_active
        );
        if (defaultPreset) setSelectedPresetId(defaultPreset.id);
      } catch (error) {
        console.error('Auto-apply preset error:', error);
      }
    };

    runAsync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroupIndex, currentItem?.category, availablePresets]);

  // Apply manual preset override
  const handleApplyPreset = async (presetId: string) => {
    if (!presetId) return;
    
    try {
      const preset = availablePresets.find(p => p.id === presetId);
      if (!preset) return;

      const updatedGroup = await applyPresetToProductGroup(currentGroup, preset.product_type || preset.category_name);
      
      const updated = [...processedItems];
      updatedGroup.forEach((updatedItem) => {
        const itemIndex = updated.findIndex(item => item.id === updatedItem.id);
        if (itemIndex !== -1) {
          updated[itemIndex] = updatedItem;
        }
      });
      
      setProcessedItems(updated);
      setSelectedPresetId(presetId);
    } catch (error) {
      alert('Failed to apply preset. Please try again.');
    }
  };

  const handleStartRecording = () => {
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
    // This fills in fields automatically based on what user said
    if (currentItem?.voiceDescription) {
      try {
        setIsGenerating(true);
        
        // Use AI to extract fields from voice description
        const aiResult = await generateProductDescription({
          voiceDescription: currentItem.voiceDescription,
          brand: currentItem.brand, // Pass existing context
          color: currentItem.color,
          size: currentItem.size,
          material: currentItem.material,
          condition: currentItem.condition as any,
          era: currentItem.era,
          style: currentItem.style,
          category: currentItem.productType,
          measurements: currentItem.measurements,
          flaws: currentItem.flaws,
          care: currentItem.care
        });

        // Extract fields from AI result (only fields with supporting info)
        const extractedFields = aiResult.extractedFields || {};
        
        // Update all items in current group with extracted fields
        // Voice-extracted fields override category preset defaults
        const updated = [...processedItems];
        currentGroup.forEach(groupItem => {
          const itemIndex = updated.findIndex(item => item.id === groupItem.id);
          if (itemIndex !== -1) {
            updated[itemIndex] = {
              ...updated[itemIndex],
              // Only update fields if extracted (don't overwrite with undefined)
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
                tags: [...new Set([...(updated[itemIndex].tags || []), ...extractedFields.tags])]
              }),
            };
          }
        });
        
        setProcessedItems(updated);
        
      } catch (error) {
        console.error('Error extracting fields from voice:', error);
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const handleClearTranscript = () => {
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

  // Individual regenerate functions
  const regenerateDescription = async () => {
    if (!currentItem.voiceDescription && !currentItem.file) {
      alert('Please add a voice description or image first');
      return;
    }
    
    setIsGenerating(true);
    
    try {
      // Check AI provider - force Google Vision if Llama is selected (Hugging Face API deprecated)
      const savedProvider = localStorage.getItem('ai_provider') as 'google-vision' | 'llama-vision' | null;
      const aiProvider = savedProvider === 'llama-vision' ? 'google-vision' : (savedProvider || 'google-vision');
      
      if (aiProvider === 'google-vision' && currentItem.file) {
        // Use intelligent template system (Hugging Face is down)
        
        // Build context from everything we know
        const aiResult = await generateProductDescription({
          voiceDescription: currentItem.voiceDescription,
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
        const suggestedTags = aiResult.suggestedTags || [];
        
        // Update all fields with generated data
        const updated = [...processedItems];
        currentGroup.forEach(groupItem => {
          const itemIndex = updated.findIndex(item => item.id === groupItem.id);
          if (itemIndex !== -1) {
            updated[itemIndex] = {
              ...updated[itemIndex],
              generatedDescription: finalDescription,
              ...(suggestedTags.length > 0 && {
                tags: [...new Set([...(updated[itemIndex].tags || []), ...suggestedTags])]
              }),
            };
          }
        });
        
        setProcessedItems(updated);
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
    const voiceDesc = currentItem.voiceDescription || '';
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
    
    const updated = [...processedItems];
    currentGroup.forEach(groupItem => {
      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
      if (itemIndex !== -1) {
        updated[itemIndex].generatedDescription = desc;
      }
    });
    setProcessedItems(updated);
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
    setDraggedThumbId(null); setDragOverThumbId(null);
  };

  const handleThumbDragEnd = () => {
    setDraggedThumbId(null);
    setDragOverThumbId(null);
  };

  const handleNext = () => {
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
    
    if (allProcessed) {
      onProcessed(processedItems);
    } else {
      alert('Please process all items before continuing');
    }
  };

  return (
    <div className="product-description-container">
      <div className="progress-bar">
        <span>Product Group {currentGroupIndex + 1} of {groupArray.length}</span>
        {currentGroup.length > 1 && (
          <span className="group-info"> ({currentGroup.length} images in this group)</span>
        )}
        <div className="progress-fill" style={{ width: `${((currentGroupIndex + 1) / groupArray.length) * 100}%` }} />
      </div>

      <div className="product-editor">
        <div className="product-preview">
          <img src={currentItem.preview} alt="Product" className="preview-image" />
          <div className="product-info">
            <span className="category-badge">{currentItem.category}</span>
          </div>
          {currentGroup.length > 1 && (
            <div className="group-thumbnails">
              <p><strong>All images in this group:</strong></p>
              <div className="thumbnail-grid">
                {currentGroup.map((groupItem, idx) => (
                  <img 
                    key={groupItem.id} 
                    src={groupItem.preview} 
                    alt={`Image ${idx + 1}`}
                    className={`group-thumbnail thumb-draggable${draggedThumbId === groupItem.id ? ' thumb-dragging' : ''}${dragOverThumbId === groupItem.id ? ' thumb-drag-over' : ''}`}
                    draggable
                    onDragStart={(e) => handleThumbDragStart(e, groupItem.id)}
                    onDragOver={(e) => handleThumbDragOver(e, groupItem.id)}
                    onDrop={(e) => handleThumbDrop(e, groupItem.id)}
                    onDragEnd={handleThumbDragEnd}
                    onDragLeave={() => setDragOverThumbId(null)}
                  />
                ))}
              </div>
            </div>
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
              <textarea 
                value={currentItem.voiceDescription || interimTranscript || ''}
                onChange={(e) => {
                  const updated = [...processedItems];
                  // Update all items in the current group
                  currentGroup.forEach(groupItem => {
                    const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                    if (itemIndex !== -1) {
                      updated[itemIndex] = {
                        ...updated[itemIndex],
                        voiceDescription: e.target.value
                      };
                    }
                  });
                  setProcessedItems(updated);
                }}
                placeholder="Click 'Start Recording' and speak your description, or type here..."
                rows={4}
                className="description-textarea"
              />
            </div>

            {/* AI Generated Description */}
            <div className="preview-ai-description" style={{ marginTop: '1rem' }}>
              <h3>AI Generated Description</h3>
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
                rows={10}
                style={{ width: '100%' }}
              />
              <button
                className="button button-primary"
                onClick={regenerateDescription}
                disabled={isGenerating}
                style={{
                  marginTop: '0.5rem',
                  width: '100%',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                }}
              >
                {isGenerating ? '🧠 Generating...' : '✨ Generate AI Description'}
              </button>
              <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem', marginBottom: 0 }}>
                AI will create a professional description from your voice input and fields
              </p>
              {exportBar && (
                <div style={{ marginTop: '1rem' }}>
                  {exportBar}
                </div>
              )}
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
                background: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px'
              }}>
                <label style={{ 
                  display: 'block', 
                  fontWeight: 600, 
                  marginBottom: '0.5rem',
                  color: '#495057'
                }}>
                  🎨 Override Preset (Optional):
                </label>
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

      {/* Listing Navigation — spans full width below both columns */}
      <div className="listing-nav-controls">
        <button
          className="button"
          onClick={handlePrevious}
          disabled={currentGroupIndex === 0}
        >
          ← Previous Listing
        </button>
        <span className="listing-nav-label">
          Listing {currentGroupIndex + 1} of {groupArray.length}
        </span>
        {currentGroupIndex < groupArray.length - 1 ? (
          <button className="button" onClick={handleNext}>
            Next Listing →
          </button>
        ) : (
          <button className="button button-secondary" onClick={handleFinish}>
            Finish ✓
          </button>
        )}
      </div>

    </div>
  );
};

export default ProductDescriptionGenerator;
