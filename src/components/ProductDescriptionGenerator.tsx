import { useState, useRef, useEffect, useMemo } from 'react';
import type { ClothingItem } from '../App';
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

  const handleGenerateProductInfo = async () => {
    if (!currentItem.voiceDescription) {
      alert('Please add a voice description first');
      return;
    }

    setIsGenerating(true);
    
    // Simulate AI generation (in production, call OpenAI API with gpt-4 or similar)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const updated = [...processedItems];
    const voiceDesc = currentItem.voiceDescription!; // Already checked above
    const category = currentItem.category || 'clothing';
    
    // Extract price from voice description if mentioned
    // Patterns: "$50", "50 dollars", "fifty dollars", "priced at 50", etc.
    const pricePatterns = [
      /\$(\d+(?:\.\d{2})?)/i,                    // $50 or $50.00
      /(\d+(?:\.\d{2})?)\s*dollars?/i,           // 50 dollars
      /price[d]?\s*(?:at|is)?\s*\$?(\d+(?:\.\d{2})?)/i, // priced at 50
      /asking\s*\$?(\d+(?:\.\d{2})?)/i,          // asking 50
      /worth\s*\$?(\d+(?:\.\d{2})?)/i            // worth 50
    ];
    
    let extractedPrice: number | undefined = undefined;
    for (const pattern of pricePatterns) {
      const match = voiceDesc.match(pattern);
      if (match) {
        extractedPrice = parseFloat(match[1]);
        console.log(`💰 Extracted price from voice: $${extractedPrice}`);
        break;
      }
    }
    
    // Use manual price if set, otherwise use extracted price, otherwise calculate smart price
    let finalPrice = currentItem.price; // Keep manual input if it exists
    
    if (!finalPrice && extractedPrice) {
      finalPrice = extractedPrice;
    } else if (!finalPrice) {
      // Calculate smart pricing based on category and description
      let basePrice = 25;
      if (category === 'Outerwear') basePrice = 60;
      else if (category === 'Sweatshirts') basePrice = 45;
      else if (category === 'Bottoms') basePrice = 40;
      else if (category === 'Activewear') basePrice = 35;
      else if (category === 'Hats' || category === 'Accessories') basePrice = 20;
      
      const lowerDesc = voiceDesc.toLowerCase();
      
      // Adjust for brand mentions
      const premiumBrands = ['supreme', 'gucci', 'prada', 'louis vuitton', 'chanel', 'balenciaga'];
      const midTierBrands = ['nike', 'adidas', 'tommy', 'calvin', 'ralph lauren', 'champion'];
      
      if (premiumBrands.some(b => lowerDesc.includes(b))) basePrice *= 3;
      else if (midTierBrands.some(b => lowerDesc.includes(b))) basePrice *= 1.5;
      
      // Adjust for condition mentions
      if (lowerDesc.includes('new') || lowerDesc.includes('unworn') || lowerDesc.includes('tags')) {
        basePrice *= 1.2;
      } else if (lowerDesc.includes('vintage')) {
        basePrice *= 1.3;
      }
      
      finalPrice = Math.round(basePrice);
    }
    
    // Enhanced feature extraction with more comprehensive detection
    const lowerDesc = voiceDesc.toLowerCase();
    
    // Expanded color detection
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
    
    // Expanded material detection
    const materialPatterns = {
      cotton: /cotton|100% cotton/i,
      polyester: /polyester|poly/i,
      leather: /leather|genuine leather|faux leather/i,
      denim: /denim|jean/i,
      silk: /silk/i,
      wool: /wool|cashmere|merino/i,
      fleece: /fleece/i,
      nylon: /nylon/i,
      spandex: /spandex|elastane|stretch/i,
      linen: /linen/i,
      suede: /suede/i,
      canvas: /canvas/i,
    };
    
    const detectedMaterials = Object.entries(materialPatterns)
      .filter(([_, pattern]) => pattern.test(lowerDesc))
      .map(([material]) => material);
    
    // NO AUTOMATIC BRAND DETECTION
    // User must manually enter brand in tags or it won't be included
    const detectedBrands: string[] = [];
    
    // Condition and style detection
    const isVintage = /vintage|retro|throwback|90s|80s|old school/i.test(lowerDesc);
    const isNew = /new|unworn|nwt|new with tags|mint|brand new/i.test(lowerDesc);
    const isLimited = /limited|exclusive|rare|special edition/i.test(lowerDesc);
    const isOversized = /oversized|baggy|loose|relaxed/i.test(lowerDesc);
    const isSlim = /slim|fitted|tight|skinny/i.test(lowerDesc);
    const hasGraphic = /graphic|print|logo|design|pattern/i.test(lowerDesc);
    const hasPockets = /pocket|pockets/i.test(lowerDesc);
    const hasZipper = /zipper|zip|zippered/i.test(lowerDesc);
    const hasHood = /hood|hoodie|hooded/i.test(lowerDesc);
    
    // Enhanced size detection with variations
    // Check manual size field first (highest priority)
    let detectedSize = currentItem.size || null;
    
    if (!detectedSize) {
      // Try to detect from speech
      const sizePatterns = [
        // Letter sizes with variations
        /\b(extra[\s-]?large|x[\s-]?large|xl)\b/i,
        /\b(double[\s-]?extra[\s-]?large|double[\s-]?xl|xx[\s-]?large|xxl)\b/i,
        /\b(triple[\s-]?extra[\s-]?large|triple[\s-]?xl|xxx[\s-]?large|xxxl)\b/i,
        /\b(extra[\s-]?small|x[\s-]?small|xs)\b/i,
        /\b(small|sm)\b/i,
        /\b(medium|med|md|m)\b/i,
        /\b(large|lg|l)\b/i,
        // Numeric sizes
        /\b([0-9]{1,2})\b/i,
      ];
      
      for (const pattern of sizePatterns) {
        const match = lowerDesc.match(pattern);
        if (match) {
          let size = match[1].toUpperCase();
          // Normalize variations
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
    }
    
    // Generate natural, flowing product description
    let generatedDesc = '';
    
    // Opening sentence - make it compelling with ALL colors mentioned
    const colorDesc = detectedColors.length === 1 
      ? detectedColors[0]
      : detectedColors.length === 2
      ? `${detectedColors[0]} and ${detectedColors[1]}`
      : detectedColors.slice(0, -1).join(', ') + ', and ' + detectedColors[detectedColors.length - 1];
    
    const openingPrefix = isNew ? 'brand new' : isVintage ? 'vintage' : 'quality';
    const colorPhrase = colorDesc ? `${colorDesc} ` : '';
    
    generatedDesc = `Discover this ${openingPrefix} ${colorPhrase}${category.toLowerCase()} piece. `;
    
    // Add the original voice description naturally integrated
    generatedDesc += voiceDesc.charAt(0).toUpperCase() + voiceDesc.slice(1);
    if (!voiceDesc.endsWith('.')) generatedDesc += '.';
    generatedDesc += ' ';
    
    // Add material and construction details
    if (detectedMaterials.length > 0) {
      if (detectedMaterials.length === 1) {
        generatedDesc += `Crafted from premium ${detectedMaterials[0]} `;
      } else {
        generatedDesc += `Made with a blend of ${detectedMaterials.slice(0, -1).join(', ')} and ${detectedMaterials[detectedMaterials.length - 1]} `;
      }
      generatedDesc += 'for exceptional comfort and durability. ';
    }
    
    // Add specific features if detected
    const features = [];
    if (hasHood) features.push('hood');
    if (hasPockets) features.push('functional pockets');
    if (hasZipper) features.push('quality zipper');
    if (hasGraphic) features.push('eye-catching graphics');
    
    if (features.length > 0) {
      generatedDesc += `Features ${features.join(', ')}. `;
    }
    
    // Add fit and style context
    if (isOversized) {
      generatedDesc += 'The oversized fit offers a relaxed, contemporary silhouette perfect for streetwear styling. ';
    } else if (isSlim) {
      generatedDesc += 'Designed with a modern slim fit that flatters your frame while maintaining comfort. ';
    }
    
    // Add size if detected
    if (detectedSize) {
      generatedDesc += `Available in size ${detectedSize}. `;
    }
    
    // Add category-specific styling suggestions
    const stylingTips: Record<string, string[]> = {
      'Tees': [
        'Layer under jackets or wear solo for effortless everyday style.',
        'Pairs perfectly with jeans, shorts, or joggers for a casual look.',
        'A versatile staple that transitions easily from day to night.',
      ],
      'Sweatshirts': [
        'Perfect for layering or wearing on its own during cooler days.',
        'Ideal for casual outings, lounging, or elevated streetwear looks.',
        'Effortlessly combines comfort with contemporary style.',
      ],
      'Outerwear': [
        'Layer over hoodies and tees for the ultimate street-ready ensemble.',
        'Essential for transitional weather and cooler seasons.',
        'Elevates any outfit with functional style and protection.',
      ],
      'Bottoms': [
        'Style with sneakers and a tee for an everyday casual look.',
        'Versatile enough for both relaxed weekends and active days.',
        'A wardrobe essential that pairs with virtually anything.',
      ],
      'Femme': [
        'Elevate your look with this feminine and fashion-forward piece.',
        'Perfect for creating versatile, trend-conscious outfits.',
        'Adds a sophisticated touch to any ensemble.',
      ],
      'Activewear': [
        'Engineered for performance, styled for everyday wear.',
        'From gym sessions to casual outings, this piece delivers.',
        'Combines athletic functionality with street-ready aesthetics.',
      ],
      'Hats': [
        'Complete your look with this statement accessory.',
        'Adds personality and finish to any outfit.',
        'A versatile piece that elevates casual and streetwear styles.',
      ],
      'Accessories': [
        'The perfect finishing touch to complete your ensemble.',
        'Add dimension and personal style to any outfit.',
        'Small details make the biggest impact.',
      ],
      'Mystery Boxes': [
        'Curated selection of quality pieces for the fashion-forward.',
        'Perfect for discovering new styles and expanding your wardrobe.',
        'Each box offers unique pieces handpicked for value and style.',
      ],
    };
    
    const categoryTips = stylingTips[category] || [
      'A stylish addition to any fashion-forward wardrobe.',
      'Versatile piece that complements various looks and occasions.',
      'Quality construction meets contemporary style.',
    ];
    
    generatedDesc += categoryTips[Math.floor(Math.random() * categoryTips.length)] + ' ';
    
    // Add condition-specific closing
    if (isNew) {
      generatedDesc += 'Brand new condition ensures you\'re getting the best quality. ';
    } else if (isVintage) {
      generatedDesc += 'Vintage authenticity brings character and timeless appeal. ';
    }
    
    // Add color context naturally
    if (detectedColors.length > 0) {
      const colorDesc = detectedColors.length === 1 
        ? `The ${detectedColors[0]} colorway` 
        : `The ${detectedColors.join(' and ')} color combination`;
      generatedDesc += `${colorDesc} offers versatility and easy styling with your existing wardrobe. `;
    }
    
    // Closing statement
    if (isLimited) {
      generatedDesc += 'Limited availability makes this a must-have for collectors and enthusiasts.';
    } else {
      generatedDesc += 'Don\'t miss out on this quality piece.';
    }
    
    // Generate comprehensive, natural tags (ONLY add brands mentioned in speech)
    const generatedTags = [
      // Core tags
      category.toLowerCase(),
      ...detectedColors,
      ...detectedMaterials,
      
      // Brand tags - ONLY if mentioned in speech
      ...detectedBrands,
      
      // Size tag
      ...(detectedSize ? [detectedSize.toLowerCase()] : []),
      
      // Style tags
      ...(isVintage ? ['vintage', 'retro', 'throwback'] : []),
      ...(isNew ? ['new', 'unworn', 'nwt'] : []),
      ...(isLimited ? ['limited edition', 'exclusive', 'rare'] : []),
      ...(isOversized ? ['oversized', 'relaxed fit'] : []),
      ...(isSlim ? ['slim fit', 'fitted'] : []),
      ...(hasGraphic ? ['graphic', 'printed'] : []),
      
      // Category-specific tags
      ...(category === 'Tees' ? ['t-shirt', 'casual', 'everyday'] : []),
      ...(category === 'Sweatshirts' ? ['hoodie', 'pullover', 'cozy'] : []),
      ...(category === 'Outerwear' ? ['jacket', 'layering', 'weather-ready'] : []),
      ...(category === 'Bottoms' ? ['pants', 'trousers', 'denim'] : []),
      ...(category === 'Activewear' ? ['athletic', 'performance', 'gym'] : []),
      
      // General fashion tags
      'streetwear',
      'fashion',
      'style',
      'wardrobe essential',
    ];
    
    // Merge manual tags with generated tags, remove duplicates
    const manualTags = currentItem.tags || [];
    const finalTags = [...new Set([...manualTags, ...generatedTags])].filter(t => t && t.trim() !== '');
    
    // Generate natural SEO-optimized title (only if not manually set)
    let finalSeoTitle = currentItem.seoTitle;
    
    if (!finalSeoTitle || finalSeoTitle.trim() === '') {
      const titleComponents = [];
      
      // Add condition prefix for impact
      if (isVintage) titleComponents.push('Vintage');
      if (isNew) titleComponents.push('New');
      if (isLimited) titleComponents.push('Rare');
      
      // Add ALL detected colors (not just first one)
      if (detectedColors.length > 0) {
        const colorStr = detectedColors.length === 1 
          ? detectedColors[0].charAt(0).toUpperCase() + detectedColors[0].slice(1)
          : detectedColors.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' and ');
        titleComponents.push(colorStr);
      }
      
      // Add category
      const categoryName = category === 'Tees' ? 'T-Shirt' : category.slice(0, -1);
      titleComponents.push(categoryName);
      
      // Add key descriptor from voice description
      const descriptorMatch = voiceDesc.match(/\b(Lakers|athletic|logo|graphic|print|stripe|solid|crew|v-neck|hoodie|pullover|zip|button)\b/i);
      if (descriptorMatch) {
        titleComponents.push(descriptorMatch[0].charAt(0).toUpperCase() + descriptorMatch[0].slice(1));
      }
      
      // Add size if detected
      if (detectedSize && ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].includes(detectedSize)) {
        titleComponents.push(`(${detectedSize})`);
      }
      
      // Join with spaces - NO HARD CHARACTER LIMIT
      // Let it be as long as needed to include all relevant info
      finalSeoTitle = titleComponents.join(' ');
      
      // Only trim if extremely long (>100 chars), and trim at word boundary
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
    
    // Apply generated info to all items in the current group
    currentGroup.forEach(groupItem => {
      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
      if (itemIndex !== -1) {
        updated[itemIndex] = {
          ...updated[itemIndex],
          price: finalPrice,
          seoTitle: finalSeoTitle,
          generatedDescription: generatedDesc,
          tags: finalTags,
          size: detectedSize || updated[itemIndex].size // Apply detected size if not manually set
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
          </div>

          <div className="form-section">
            <h3>Manual Product Info (Optional)</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
              Enter details manually or let AI generate them. You can edit AI suggestions after generation.
            </p>
            
            <div className="info-item">
              <label>Price ($):</label>
              <input 
                type="number" 
                value={currentItem.price || ''} 
                onChange={(e) => {
                  const updated = [...processedItems];
                  // Update all items in the group
                  currentGroup.forEach(groupItem => {
                    const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                    if (itemIndex !== -1) {
                      updated[itemIndex].price = e.target.value ? parseFloat(e.target.value) : undefined;
                    }
                  });
                  setProcessedItems(updated);
                }}
                placeholder="e.g., 49.99"
                className="info-input"
                step="0.01"
                min="0"
              />
            </div>

            <div className="info-item">
              <label>SEO Title:</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  value={currentItem.seoTitle || ''} 
                  onChange={(e) => {
                    const updated = [...processedItems];
                    // Update all items in the group
                    currentGroup.forEach(groupItem => {
                      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                      if (itemIndex !== -1) {
                        updated[itemIndex].seoTitle = e.target.value;
                      }
                    });
                    setProcessedItems(updated);
                  }}
                  placeholder="e.g., Vintage Black Rolling Stones Tee"
                  className="info-input"
                  style={{ flex: 1 }}
                />
                <button
                  className="button button-secondary"
                  onClick={regenerateSeoTitle}
                  style={{ minWidth: '100px' }}
                  title="Regenerate SEO title from voice description"
                >
                  🔄 Regen
                </button>
              </div>
            </div>

            <div className="info-item">
              <label>Tags (comma-separated):</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  value={currentItem.tags?.join(', ') || ''} 
                  onChange={(e) => {
                    const updated = [...processedItems];
                    // Update all items in the group
                    currentGroup.forEach(groupItem => {
                      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                      if (itemIndex !== -1) {
                        updated[itemIndex].tags = e.target.value ? e.target.value.split(',').map(t => t.trim()).filter(t => t) : [];
                      }
                    });
                    setProcessedItems(updated);
                  }}
                  placeholder="e.g., vintage, tees, rock, black"
                  className="info-input"
                  style={{ flex: 1 }}
                />
                <button
                  className="button button-secondary"
                  onClick={regenerateTags}
                  style={{ minWidth: '100px' }}
                  title="Regenerate tags from voice description"
                >
                  🔄 Regen
                </button>
              </div>
            </div>

            <div className="info-item">
              <label>Size:</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  value={currentItem.size || ''} 
                  onChange={(e) => {
                    const updated = [...processedItems];
                    // Update all items in the group
                    currentGroup.forEach(groupItem => {
                      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
                      if (itemIndex !== -1) {
                        updated[itemIndex].size = e.target.value;
                      }
                    });
                    setProcessedItems(updated);
                  }}
                  placeholder="e.g., M, L, XL, 32, 10"
                  className="info-input"
                  style={{ flex: 1 }}
                />
                <button
                  className="button button-secondary"
                  onClick={regenerateSize}
                  style={{ minWidth: '100px' }}
                  title="Detect size from voice description"
                >
                  🔄 Regen
                </button>
              </div>
            </div>
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
