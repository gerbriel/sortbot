import { useState, useRef, useEffect, useMemo } from 'react';
import type { ClothingItem } from '../App';
import { intelligentMatch } from '../lib/brandMatcher';
import { Target } from 'lucide-react';
import { ComprehensiveProductForm } from './ComprehensiveProductForm';
import './ProductDescriptionGenerator.css';

interface ProductDescriptionGeneratorProps {
  items: ClothingItem[];
  onProcessed: (items: ClothingItem[]) => void;
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
  onProcessed 
}) => {
  const [processedItems, setProcessedItems] = useState<ClothingItem[]>(items);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const isStartingRef = useRef(false);
  const lastClickTimeRef = useRef(0);
  const buttonStateTransitionRef = useRef(0);

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
  }, [processedItems, currentGroupIndex]);

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

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
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

  const handleStopRecording = () => {
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
  const BANNED_PHRASES = [
    'perfect for any occasion',
    'timeless piece',
    'elevate your wardrobe',
    'must-have',
    'wardrobe staple',
    'unparalleled',
    'investment piece',
    'holy grail',
    'game changer',
  ];

  // Filter function to remove banned phrases
  const removeBannedPhrases = (text: string): string => {
    let filtered = text;
    BANNED_PHRASES.forEach(phrase => {
      const regex = new RegExp(phrase, 'gi');
      filtered = filtered.replace(regex, '');
    });
    // Clean up double spaces and extra punctuation
    return filtered.replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim();
  };

  // Format measurements for description
  const formatMeasurements = (measurements: any, size?: string): string => {
    if (!measurements) return '';
    
    const lines = [];
    if (size) lines.push(`✠ SIZE - ${size}`);
    if (measurements.pitToPit) lines.push(`✠ PIT TO PIT - ${measurements.pitToPit}"`);
    if (measurements.length) lines.push(`✠ LENGTH - ${measurements.length}"`);
    if (measurements.sleeve) lines.push(`✠ SLEEVE - ${measurements.sleeve}"`);
    if (measurements.shoulder) lines.push(`✠ SHOULDER - ${measurements.shoulder}"`);
    if (measurements.waist) lines.push(`✠ WAIST - ${measurements.waist}"`);
    if (measurements.inseam) lines.push(`✠ INSEAM - ${measurements.inseam}"`);
    if (measurements.rise) lines.push(`✠ RISE - ${measurements.rise}"`);
    
    if (lines.length === 0) return '';
    
    return lines.join('\n');
  };

  // Format condition for description - cleaner vintage style
  const formatCondition = (condition?: string, flaws?: string): string => {
    if (!condition) return 'Light vintage wear consistent with age.';
    
    const conditionMap: Record<string, string> = {
      'NWT': 'Brand new with tags. Deadstock condition.',
      'Like New': 'Excellent vintage condition with minimal signs of wear.',
      'Excellent': 'Light vintage wear consistent with age.',
      'Good': 'Good vintage condition with moderate wear throughout.',
      'Fair': 'Fair condition with noticeable wear and character.'
    };
    
    let text = conditionMap[condition] || 'Light vintage wear consistent with age.';
    
    if (flaws && flaws.trim()) {
      text += `\n\nFlaws: ${flaws}`;
    }
    
    return text;
  };

  const handleGenerateProductInfo = async () => {
    if (!currentItem.voiceDescription) {
      alert('Please add a voice description first');
      return;
    }

    setIsGenerating(true);
    
    // Simulate AI generation (in production, call OpenAI API)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const updated = [...processedItems];
    const voiceDesc = currentItem.voiceDescription!;
    const category = currentItem.category || 'clothing';
    const lowerDesc = voiceDesc.toLowerCase();
    
    // INTELLIGENT BRAND/MODEL MATCHING using brand database - DO THIS FIRST
    const brandMatch = intelligentMatch(voiceDesc);
    
    // Extract brand and model info from intelligent matcher
    const extractedBrand = brandMatch.brand || '';
    const extractedModelName = brandMatch.modelName || '';
    const extractedModelNumber = brandMatch.modelNumber || '';
    const extractedBrandCategory = brandMatch.brandCategory;
    const extractedSubcultures = brandMatch.subcultures || [];
    const suggestedPriceRange = brandMatch.priceRange;
    const collectibilityScore = brandMatch.collectibility;
    // const matchConfidence = brandMatch.confidence; // Available for future use
    
    // Check if brand/material/model were explicitly mentioned in voice description
    // Only use extracted values if they were actually mentioned
    const voiceExplicitlyMentionsBrand = extractedBrand && 
      lowerDesc.includes(extractedBrand.toLowerCase());
    const voiceExplicitlyMentionsModel = extractedModelName && 
      lowerDesc.includes(extractedModelName.toLowerCase());
    const voiceExplicitlyMentionsModelNumber = extractedModelNumber && 
      lowerDesc.includes(extractedModelNumber.toLowerCase());
    
    // Condition extraction (only if not manually set) - DO THIS EARLY for pricing
    let extractedCondition = currentItem.condition || '';
    if (!extractedCondition) {
      if (/new with tags|nwt|brand new/i.test(voiceDesc)) {
        extractedCondition = 'NWT';
      } else if (/like new|mint|pristine|perfect/i.test(voiceDesc)) {
        extractedCondition = 'Like New';
      } else if (/excellent|great condition/i.test(voiceDesc)) {
        extractedCondition = 'Excellent';
      } else if (/good condition|gently used/i.test(voiceDesc)) {
        extractedCondition = 'Good';
      } else if (/fair|worn|used/i.test(voiceDesc)) {
        extractedCondition = 'Fair';
      }
    }
    
    // Extract price from voice description if mentioned
    const pricePatterns = [
      /\$(\d+(?:\.\d{2})?)/i,
      /(\d+(?:\.\d{2})?)\s*dollars?/i,
      /price[d]?\s*(?:at|is)?\s*\$?(\d+(?:\.\d{2})?)/i,
      /asking\s*\$?(\d+(?:\.\d{2})?)/i,
    ];
    
    let extractedPrice: number | undefined = undefined;
    for (const pattern of pricePatterns) {
      const match = voiceDesc.match(pattern);
      if (match) {
        extractedPrice = parseFloat(match[1]);
        break;
      }
    }
    
    // Use manual price > extracted price > smart calculation
    let finalPrice = currentItem.price;
    
    if (!finalPrice && extractedPrice) {
      finalPrice = extractedPrice;
    } else if (!finalPrice) {
      // Use intelligent match price range if available
      if (suggestedPriceRange && suggestedPriceRange.length === 2) {
        // Use midpoint of price range as base, adjusted for condition
        const [minPrice, maxPrice] = suggestedPriceRange;
        const midPrice = (minPrice + maxPrice) / 2;
        
        // Adjust based on condition
        let conditionMultiplier = 1.0;
        if (extractedCondition === 'NWT') conditionMultiplier = 1.3;
        else if (extractedCondition === 'Like New') conditionMultiplier = 1.1;
        else if (extractedCondition === 'Excellent') conditionMultiplier = 1.0;
        else if (extractedCondition === 'Good') conditionMultiplier = 0.8;
        else if (extractedCondition === 'Fair') conditionMultiplier = 0.6;
        
        finalPrice = Math.round(midPrice * conditionMultiplier);
      } else {
        // Fallback to category-based pricing
        let basePrice = 25;
        if (category === 'Outerwear') basePrice = 60;
        else if (category === 'Sweatshirts') basePrice = 45;
        else if (category === 'Bottoms') basePrice = 40;
        else if (category === 'Activewear') basePrice = 35;
        else if (category === 'Hats' || category === 'Accessories') basePrice = 20;
        
        finalPrice = Math.round(basePrice);
      }
    }
    
    // Detect colors - ALL of them
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
    
    // Detect materials
    const materialPatterns = {
      cotton: /cotton|100% cotton/i,
      polyester: /polyester|poly/i,
      leather: /leather/i,
      denim: /denim|jean/i,
      silk: /silk/i,
      wool: /wool|cashmere/i,
      fleece: /fleece/i,
      nylon: /nylon/i,
      linen: /linen/i,
    };
    
    const detectedMaterials = Object.entries(materialPatterns)
      .filter(([_, pattern]) => pattern.test(lowerDesc))
      .map(([material]) => material);
    
    // Detect size
    let detectedSize = currentItem.size || null;
    if (!detectedSize) {
      const sizePatterns = [
        /\b(extra[\s-]?large|x[\s-]?large|xl)\b/i,
        /\b(xx[\s-]?large|xxl)\b/i,
        /\b(xxx[\s-]?large|xxxl)\b/i,
        /\b(extra[\s-]?small|x[\s-]?small|xs)\b/i,
        /\b(small|sm)\b/i,
        /\b(medium|med|md|m)\b/i,
        /\b(large|lg|l)\b/i,
      ];
      
      for (const pattern of sizePatterns) {
        const match = lowerDesc.match(pattern);
        if (match) {
          let size = match[1].toUpperCase();
          if (/x[\s-]?large|xl/i.test(size)) size = 'XL';
          else if (/xxl/i.test(size)) size = 'XXL';
          else if (/xxxl/i.test(size)) size = 'XXXL';
          else if (/x[\s-]?small|xs/i.test(size)) size = 'XS';
          else if (/small|sm/i.test(size)) size = 'S';
          else if (/medium|med|md/i.test(size)) size = 'M';
          else if (/large|lg/i.test(size) && !/x/i.test(size)) size = 'L';
          
          detectedSize = size;
          break;
        }
      }
    }
    
    // Era extraction
    let extractedEra = '';
    const eraPatterns = [
      /\b(vintage|retro|90s|80s|70s|60s|y2k|modern|contemporary|classic)\b/i
    ];
    
    for (const pattern of eraPatterns) {
      const match = voiceDesc.match(pattern);
      if (match) {
        extractedEra = match[1].toLowerCase();
        break;
      }
    }
    
    // Flaws extraction (only if not manually filled)
    let extractedFlaws = currentItem.flaws || '';
    if (!extractedFlaws) {
      const flawPatterns = [
        /flaw[s]?[:\s]+([^.]+)/i,
        /stain[s]?[:\s]+([^.]+)/i,
        /hole[s]?[:\s]+([^.]+)/i,
        /tear[s]?[:\s]+([^.]+)/i,
        /damage[d]?[:\s]+([^.]+)/i,
        /wear[:\s]+([^.]+)/i,
      ];
      
      for (const pattern of flawPatterns) {
        const match = voiceDesc.match(pattern);
        if (match) {
          extractedFlaws = match[1].trim();
          break;
        }
      }
    }
    
    // Material extraction (only if not manually filled)
    let extractedMaterial = currentItem.material || '';
    if (!extractedMaterial && detectedMaterials.length > 0) {
      extractedMaterial = detectedMaterials.join(', ');
    }
    
    // Color extraction (only if not manually filled) - for Shopify Option2
    let extractedColor = currentItem.color || '';
    if (!extractedColor && detectedColors.length > 0) {
      // Use first detected color or combine if multiple
      extractedColor = detectedColors.length === 1 
        ? detectedColors[0].charAt(0).toUpperCase() + detectedColors[0].slice(1)
        : detectedColors.slice(0, 2).map(c => c.charAt(0).toUpperCase() + c.slice(1)).join('/');
    }
    
    // Use manual entry if provided, otherwise use extracted value
    const finalBrand = currentItem.brand || extractedBrand;
    const finalEra = currentItem.era || extractedEra;
    const finalCondition = extractedCondition;
    const finalFlaws = extractedFlaws;
    const finalMaterial = extractedMaterial;
    
    // NATURAL DESCRIPTION GENERATION - Clean vintage format
    let generatedDesc = '';
    
    // Only check if material was explicitly mentioned in voice or manual input
    const voiceHasMaterial = finalMaterial && (
      voiceDesc.toLowerCase().includes(finalMaterial.toLowerCase()) || 
      currentItem.material // manually typed
    );
    
    // Add measurements section at top if available
    const measurementsSection = formatMeasurements(currentItem.measurements, detectedSize || undefined);
    if (measurementsSection) {
      generatedDesc += measurementsSection + '\n\n';
    }
    
    // Main description paragraph - clean and descriptive
    // Only use voice description, cleaning it up
    const cleanedVoice = voiceDesc.charAt(0).toUpperCase() + voiceDesc.slice(1);
    generatedDesc += cleanedVoice;
    if (!cleanedVoice.endsWith('.')) generatedDesc += '.';
    
    // Add construction/material details if EXPLICITLY mentioned
    if (voiceHasMaterial) {
      generatedDesc += `\n\n${finalMaterial} construction`;
      
      // Add fit style if detected
      const fitWords = ['boxy', 'oversized', 'slim', 'relaxed', 'fitted', 'cropped', 'longline'];
      const hasFitMention = fitWords.some(fit => voiceDesc.toLowerCase().includes(fit));
      if (hasFitMention) {
        const fitMatch = fitWords.find(fit => voiceDesc.toLowerCase().includes(fit));
        generatedDesc += ` with a ${fitMatch} fit`;
      }
      
      // Add era styling if mentioned
      if (finalEra && voiceDesc.toLowerCase().includes(finalEra)) {
        generatedDesc += ` typical of the ${finalEra} era`;
      }
      
      generatedDesc += '.';
    }
    
    // Add USA made tag if commonly mentioned
    if (voiceDesc.toLowerCase().includes('made in usa') || voiceDesc.toLowerCase().includes('made in america')) {
      generatedDesc += ' Made in USA tag.';
    }
    
    // Add vintage character note
    if (finalEra && (finalEra.includes('vintage') || finalEra.includes('90s') || finalEra.includes('80s'))) {
      generatedDesc += ' Soft natural fade throughout that adds character without structural flaws.';
    }
    
    // Add condition statement
    generatedDesc += `\n\n${formatCondition(finalCondition || currentItem.condition, finalFlaws || currentItem.flaws)}`;
    
    // Standard disclaimer
    generatedDesc += '\n\nCondition shown in pictures. Minor signs of wear consistent with vintage age may not be individually listed.';
    
    // Add collectibility note for highly collectible items (8+)
    if (collectibilityScore && collectibilityScore >= 8) {
      generatedDesc += '\n\nHighly collectible piece suited for collection or everyday wear.';
    } else {
      generatedDesc += '\n\nHigh-quality piece suited for everyday wear or collection.';
    }
    
    // Standard closing
    generatedDesc += '\n\nNext-day shipping.\nAll sales final.';
    
    // Filter banned phrases
    generatedDesc = removeBannedPhrases(generatedDesc);
    
    // Generate tags - clean hashtag style (lowercase, no spaces)
    const generatedTags = [];
    
    // Add brand if explicitly mentioned
    if (finalBrand && finalBrand.toLowerCase() !== 'unknown' && 
        (voiceDesc.toLowerCase().includes(finalBrand.toLowerCase()) || currentItem.brand)) {
      generatedTags.push(finalBrand.toLowerCase().replace(/\s+/g, ''));
    }
    
    // Add era/decade tags
    if (finalEra) {
      const eraTag = finalEra.toLowerCase().replace(/\s+/g, '');
      generatedTags.push(eraTag);
      // Add decade-specific tags
      if (finalEra.includes('90s')) generatedTags.push('90s');
      if (finalEra.includes('80s')) generatedTags.push('80s');
      if (finalEra.includes('vintage')) generatedTags.push('vintage');
    }
    
    // Add category-based tags
    const categoryTag = category.toLowerCase().replace(/\s+/g, '');
    generatedTags.push(categoryTag);
    
    // Add style descriptors from voice
    const styleKeywords = ['oversized', 'boxy', 'cropped', 'fitted', 'relaxed', 'heavyweight', 'crewneck', 'vneck', 'hoodie', 'embroidered', 'graphic', 'minimal', 'athletic', 'sportswear', 'workwear', 'vintage'];
    styleKeywords.forEach(keyword => {
      if (voiceDesc.toLowerCase().includes(keyword)) {
        generatedTags.push(keyword.replace(/\s+/g, ''));
      }
    });
    
    // Add fit descriptor if present
    if (voiceDesc.toLowerCase().includes('boxy')) generatedTags.push('boxyfit');
    
    const manualTags = currentItem.tags || [];
    const finalTags = [...new Set([...manualTags, ...generatedTags])].filter(t => t && t.trim() !== '');
    
    // Generate SEO title (only if not manually set)
    let finalSeoTitle = currentItem.seoTitle;
    
    if (!finalSeoTitle || finalSeoTitle.trim() === '') {
      const titleComponents = [];
      
      // Add size at the beginning if available
      if (detectedSize && ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].includes(detectedSize)) {
        titleComponents.push(detectedSize);
      }
      
      // Add era/vintage marker
      if (finalEra) titleComponents.push(finalEra.charAt(0).toUpperCase() + finalEra.slice(1));
      
      // Add brand if explicitly mentioned
      if (finalBrand && finalBrand.toLowerCase() !== 'unknown') titleComponents.push(finalBrand);
      
      // Add category
      const categoryForTitle = category === 'Tees' ? 'Tee' : 
                               category === 'Sweatshirts' ? 'Sweatshirt' :
                               category === 'Outerwear' ? 'Jacket' :
                               category;
      titleComponents.push(categoryForTitle);
      
      // Add key description words from voice
      const keyWords = voiceDesc.split(' ').slice(0, 3).map(w => 
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(' ');
      if (keyWords && !titleComponents.join(' ').toLowerCase().includes(keyWords.toLowerCase())) {
        titleComponents.push(keyWords);
      }
      
      // Add colors
      if (detectedColors.length > 0) {
        const colorStr = detectedColors.slice(0, 2)
          .map(c => c.charAt(0).toUpperCase() + c.slice(1))
          .join('/');
        titleComponents.push(colorStr);
      }
      
      finalSeoTitle = titleComponents.join(' ');
      
      // Smart trim at word boundary if too long
      if (finalSeoTitle.length > 100) {
        const words = finalSeoTitle.split(' ');
        let trimmed = '';
        for (const word of words) {
          if ((trimmed + ' ' + word).length > 100) break;
          trimmed += (trimmed ? ' ' : '') + word;
        }
        finalSeoTitle = trimmed;
      }
    }
    
    // Apply to all items in group
    currentGroup.forEach(groupItem => {
      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
      if (itemIndex !== -1) {
        updated[itemIndex] = {
          ...updated[itemIndex],
          price: finalPrice,
          seoTitle: finalSeoTitle,
          generatedDescription: generatedDesc,
          tags: finalTags,
          size: detectedSize || updated[itemIndex].size,
          // FIXED: Only use extracted brand/model if explicitly mentioned in voice or manually entered
          brand: updated[itemIndex].brand || (voiceExplicitlyMentionsBrand ? extractedBrand : undefined),
          color: updated[itemIndex].color || extractedColor,
          condition: updated[itemIndex].condition || (extractedCondition as any),
          flaws: updated[itemIndex].flaws || extractedFlaws,
          material: updated[itemIndex].material || extractedMaterial,
          measurements: updated[itemIndex].measurements,
          era: updated[itemIndex].era || extractedEra,
          care: updated[itemIndex].care,
          // NEW: Add intelligent match data only if explicitly mentioned
          modelName: updated[itemIndex].modelName || (voiceExplicitlyMentionsModel ? extractedModelName : undefined),
          modelNumber: updated[itemIndex].modelNumber || (voiceExplicitlyMentionsModelNumber ? extractedModelNumber : undefined),
          brandCategory: extractedBrandCategory || updated[itemIndex].brandCategory,
          subculture: extractedSubcultures.length > 0 ? extractedSubcultures : updated[itemIndex].subculture,
        };
      }
    });
    
    setProcessedItems(updated);
    setIsGenerating(false);
  };

  // Individual regenerate functions
  const regenerateDescription = () => {
    if (!currentItem.voiceDescription) {
      alert('Please add a voice description first');
      return;
    }
    
    const voiceDesc = currentItem.voiceDescription;
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
  };

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
    
    // Add ALL detected colors
    if (detectedColors.length > 0) {
      const colorStr = detectedColors.length === 1 
        ? detectedColors[0].charAt(0).toUpperCase() + detectedColors[0].slice(1)
        : detectedColors.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' and ');
      titleParts.push(colorStr);
    }
    
    // Add category
    if (category) titleParts.push(category === 'Tees' ? 'T-Shirt' : category.slice(0, -1));
    
    // Add key descriptor
    const descriptorMatch = voiceDesc.match(/\b(Lakers|athletic|logo|graphic|print|stripe|solid|crew|v-neck|hoodie|pullover|zip|button)\b/i);
    if (descriptorMatch) {
      titleParts.push(descriptorMatch[0].charAt(0).toUpperCase() + descriptorMatch[0].slice(1));
    }
    
    // Add size
    if (size) titleParts.push(`(${size})`);
    
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

  const handleNext = () => {
    if (currentGroupIndex < groupArray.length - 1) {
      setCurrentGroupIndex(currentGroupIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentGroupIndex > 0) {
      setCurrentGroupIndex(currentGroupIndex - 1);
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
                    className="group-thumbnail"
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
              regenerateSeoTitle={regenerateSeoTitle}
              regenerateTags={regenerateTags}
              regenerateSize={regenerateSize}
            />
          </div>

          <div className="form-section">
            <button 
              className="button" 
              onClick={handleGenerateProductInfo}
              disabled={!currentItem.voiceDescription || isGenerating}
            >
              {isGenerating ? (
                <span className="loading">
                  <span className="spinner"></span>
                  Generating...
                </span>
              ) : (
                '✨ Generate Product Info with AI'
              )}
            </button>
            <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem' }}>
              AI will generate or enhance the fields above based on your voice description
            </p>
          </div>

          {currentItem.generatedDescription && (
            <div className="generated-info">
              <h3>AI Generated Content (Edit as needed)</h3>
              
              <div className="info-item">
                <label>Product Description:</label>
                <textarea 
                  value={currentItem.generatedDescription}
                  onChange={(e) => {
                    const updated = [...processedItems];
                    // Update all items in the group
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
                />
                <button
                  className="button button-secondary"
                  onClick={regenerateDescription}
                  style={{ marginTop: '0.5rem', width: '100%' }}
                  title="Regenerate description from voice"
                >
                  🔄 Regenerate Description
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="navigation-controls">
        <button 
          className="button" 
          onClick={handlePrevious}
          disabled={currentGroupIndex === 0}
        >
          ← Previous
        </button>
        
        {currentGroupIndex < groupArray.length - 1 ? (
          <button 
            className="button" 
            onClick={handleNext}
          >
            Next →
          </button>
        ) : (
          <button 
            className="button button-secondary" 
            onClick={handleFinish}
          >
            Finish Processing ✓
          </button>
        )}
      </div>
    </div>
  );
};

export default ProductDescriptionGenerator;
