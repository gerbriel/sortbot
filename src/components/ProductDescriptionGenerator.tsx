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
import { useStoreItemArray, liveArrayRef } from '../lib/workflowStore';
import { buildGroupArray } from '../lib/grouping';
import { fetchActiveChips, getBrandTerms } from '../lib/vocabService';
import type { DescriptionSettings } from '../lib/descriptionSettings';
import './ProductDescriptionGenerator.css';

// Live view into the store — replaces the old per-render processedItems mirror.
// .current always reads the CURRENT full item list (async handlers can't go stale).
const processedItemsRef = liveArrayRef('processedItems');

// Quick descriptor keywords — one tap adds proven resale keywords to the
// item's description field, so the seller doesn't have to know (or dictate)
// the vocabulary. They flow into the generated description, the title keyword
// engine, and the description-sourced tags exactly like spoken words.
const DESCRIPTOR_KEYWORDS = [
  'faded', 'distressed', 'boxy', 'oversized', 'cropped', 'baggy',
  'graphic', 'embroidered', 'single stitch', 'double stitch',
  'streetwear', 'skater', 'grunge', 'y2k', 'workwear', 'sports',
  'hooded', 'zip up', 'quarter zip', 'snap button', 'color block',
  'plaid', 'flannel', 'striped', 'tie dye', 'camo',
  'heavyweight', 'lightweight', 'made in usa', 'deadstock', 'rare',
];

interface ProductDescriptionGeneratorProps {
  onProcessed: (items: ClothingItem[]) => void;
  onDownloadCSV?: () => void;
  batchId?: string | null;
  /** Per-workspace description format (organizations.description_settings);
   *  null → defaults. Passed into the generator on every Generate. */
  descriptionSettings?: DescriptionSettings | null;
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
  onProcessed,
  onDownloadCSV,
  batchId,
  descriptionSettings,
}) => {
  // Stage 2b: processedItems lives in workflowStore — the SAME list App.tsx
  // reads/writes. This is the FULL item list (uncategorized singles included);
  // the Step-3 visibility filter is applied inside buildGroupArray. All 26
  // targeted setProcessedItems call sites work unchanged against the full list.
  // The old duplicated local copy, the items-prop sync effect, and the
  // isResettingRef suppression dance are gone — there is one homework sheet now.
  const [processedItems, setProcessedItems] = useStoreItemArray('processedItems');
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
  const [duplicateTitleWarning, setDuplicateTitleWarning] = useState(false);
  // Debounce timer for auto-saving current group fields to the products table.
  // Fires 2s after the last processedItems change so a page refresh never loses
  // voiceDescription, generatedDescription, seoTitle, or any typed field values.
  const productSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Direct save ref — holds latest group to save, set by user edits, consumed by
  // debouncedDirectSave. (Historically this bypassed the isResettingRef feedback
  // loop; that loop no longer exists — kept because it's still the most direct
  // per-edit DB save path.)
  const pendingSaveGroupRef = useRef<ClothingItem[] | null>(null);

  const debouncedDirectSave = (group: ClothingItem[]) => {
    console.log('[PDG] debouncedDirectSave SCHEDULED', {
      id: group[0]?.id,
      seoTitle: group[0]?.seoTitle,
      voiceDescription: group[0]?.voiceDescription?.slice(0, 60),
      generatedDescription: group[0]?.generatedDescription?.slice(0, 60),
      brand: group[0]?.brand,
      size: group[0]?.size,
      price: group[0]?.price,
    });
    pendingSaveGroupRef.current = group;
    if (productSaveTimerRef.current) clearTimeout(productSaveTimerRef.current);
    productSaveTimerRef.current = setTimeout(() => {
      const g = pendingSaveGroupRef.current;
      if (g && g.length > 0) {
        console.log('[PDG] debouncedDirectSave FIRING for id:', g[0]?.id);
        syncGroupFieldsToDatabase(g, batchId ?? null).catch((e) => console.error('[PDG] debouncedDirectSave syncGroupFields threw:', e));
        pendingSaveGroupRef.current = null;
      } else {
        console.warn('[PDG] debouncedDirectSave fired but pendingSaveGroupRef was empty/null');
      }
    }, 800);
  };

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
    return { size: 480, zoom: 6, enabled: true };
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
  // Stage 2b: previousItemsLengthRef / previousBatchIdRef / previousItemsRefRef /
  // isResettingRef / the processedItemsRef mirror are all GONE — they existed to
  // keep the duplicated local copy in sync with the items prop. The store is the
  // single source of truth now; processedItemsRef (module-level) reads it live.

  // buildGroupArray moved to lib/grouping.ts (tested there). It applies the
  // Step-3 visibility filter AND the tolerant group-id rule that accepts both
  // leader-id groups and fresh-UUID groups — the fix for Next/Prev cycling
  // per-image instead of per-product-group.

  // Memoize group calculation to avoid unnecessary recalculations
  const { groupArray, currentGroup, currentItem } = useMemo(() => {
    const groupArray = buildGroupArray(processedItems);
    const currentGroup = groupArray[currentGroupIndex] || [];
    const currentItem = currentGroup[0];
    
    return { groupArray, currentGroup, currentItem };
  }, [processedItems, currentGroupIndex]);

  // Notify App that items changed so it schedules the workflow_state auto-save.
  // Stage 2b: the store is the single source of truth — this callback carries
  // the already-current full list purely as an auto-save trigger. The old
  // isResettingRef / length-mismatch suppression guards are gone because the
  // feedback loop they guarded against (edit → onProcessed → prop → reset)
  // no longer exists: there is no prop and no local copy to reset.
  useEffect(() => {
    if (!hasMountedRef.current) {
      // First render - just mark as mounted, don't sync
      hasMountedRef.current = true;
      return;
    }
    onProcessed(processedItems);
  // onProcessed intentionally omitted — it's a stable callback from the parent and
  // including it causes this effect to re-fire on every App render (new function reference).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedItems]);

  // Mark unsaved changes whenever processedItems mutates after mount
  useEffect(() => {
    if (!hasMountedRef.current) return;
    setHasUnsavedChanges(true);
  }, [processedItems]);

  // Debounced product-table save — fires 500ms after the last processedItems change.
  // isResettingRef check intentionally removed: a prop-reset saves DB data back to DB (no-op)
  // and removing it ensures ComprehensiveProductForm edits are always persisted.
  useEffect(() => {
    if (!hasMountedRef.current) {
      console.log('[PDG] processedItems debounce effect: skipping (not mounted)');
      return;
    }
    console.log('[PDG] processedItems debounce effect: scheduling save');
    if (productSaveTimerRef.current) clearTimeout(productSaveTimerRef.current);
    productSaveTimerRef.current = setTimeout(() => {
      const group = buildGroupArray(processedItems)[currentGroupIndex];
      if (group && group.length > 0) {
        console.log('[PDG] processedItems debounce effect FIRED → syncGroupFields', {
          id: group[0]?.id,
          seoTitle: group[0]?.seoTitle,
          voiceDescription: group[0]?.voiceDescription?.slice(0, 60),
          brand: group[0]?.brand,
        });
        syncGroupFieldsToDatabase(group, batchId ?? null).catch((e) => console.error('[PDG] debounce effect syncGroupFields threw:', e));
      } else {
        console.warn('[PDG] processedItems debounce effect fired but group is empty at index', currentGroupIndex);
      }
    }, 500);
    return () => {
      if (productSaveTimerRef.current) clearTimeout(productSaveTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedItems]);

  // Flush pending save on page unload so a quick refresh never loses data
  useEffect(() => {
    const flushOnUnload = () => {
      if (productSaveTimerRef.current) {
        clearTimeout(productSaveTimerRef.current);
        productSaveTimerRef.current = null;
      }
      const group = buildGroupArray(processedItems)[currentGroupIndex];
      if (group && group.length > 0) {
        // Use sendBeacon-friendly sync approach: fire-and-forget
        syncGroupFieldsToDatabase(group, batchId ?? null).catch(() => {});
      }
    };
    // beforeunload alone is unreliable on back-button navigation and mobile
    // (bfcache freezes the page without firing it) — pagehide is the dependable
    // signal, so listen to both. flushOnUnload is idempotent.
    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    return () => {
      window.removeEventListener('beforeunload', flushOnUnload);
      window.removeEventListener('pagehide', flushOnUnload);
    };
  }, [processedItems, currentGroupIndex, batchId]);

  // Stage 2b: the prop-sync effect (batchChanged/lengthChanged/structureKey
  // heuristics + isResettingRef) is GONE — PDG reads the store directly, so
  // App-side changes (grouping, categorizing, DB hydration) are visible on the
  // next render with no sync machinery. Batch switches remount this component
  // via key={currentBatchId} in App.tsx, which resets navigation to group 0.
  // Safety net: clamp the group index if the group list shrinks while mounted
  // (e.g. items deleted in Step 2), so navigation never points past the end.
  useEffect(() => {
    if (groupArray.length > 0 && currentGroupIndex > groupArray.length - 1) {
      setCurrentGroupIndex(groupArray.length - 1);
    }
  }, [groupArray.length, currentGroupIndex]);

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
          // inseam: many STT engines mis-hear it ("and seam", "in seem", "in steam", etc.)
          .replace(/\b(in seam|in-seam|unseam|and seam|in seem|in steam|in-scene|in scene|in-team|inseams?)\b(?=\s+[\d])/gi, 'inseam')
          .replace(/\b(in seam|in-seam|unseam|and seam|in seem|in steam)\b/gi, 'inseam')
          .replace(/\b(out seam|out-seam|out seem|out-seem|outseams?)\b/gi, 'outseam')
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

            // DESCRIPTION MODE: while dictating a description, every word up to
            // the closing "period" is narration — words like "sleeve", "style",
            // "length" must NOT be treated as new field commands mid-sentence.
            if (activeVoiceFieldRef.current === 'customDescription') {
              const v = (pendingFieldValueRef.current + ' ' + seg).trim();
              if (v) applyTableFieldRef.current('customDescription', v);
              pendingFieldValueRef.current = '';
              activeVoiceFieldRef.current = null;
              continue;
            }

            // Find ALL keyword occurrences within this segment (word-boundary-aware).
            // This lets a single period-bounded chunk like "width 18 length 28 period"
            // correctly yield TWO separate field writes instead of one.
            type KwHit = { pos: number; kw: string; fk: string };
            const hits: KwHit[] = [];
            for (const [kw, fk] of Object.entries(VOICE_KEYWORD_TO_FIELD)) {
              const idx = segLower.indexOf(kw);
              if (idx === -1) continue;
              const prevOk = idx === 0 || segLower[idx - 1] === ' ';
              const nextOk = idx + kw.length >= segLower.length || segLower[idx + kw.length] === ' ';
              if (prevOk && nextOk) hits.push({ pos: idx, kw, fk });
            }
            // Sort by position; prefer longer keyword at the same position
            hits.sort((a, b) => a.pos - b.pos || b.kw.length - a.kw.length);
            // Remove shorter keywords shadowed by a longer one at the same start
            const kwHits = hits.filter((h, i) => i === 0 || h.pos >= hits[i - 1].pos + hits[i - 1].kw.length);

            if (kwHits.length === 0) {
              // No keyword — continuation of current active field, then "period" closes it
              if (activeVoiceFieldRef.current) {
                pendingFieldValueRef.current = (pendingFieldValueRef.current + ' ' + seg).trim();
              }
              const f = activeVoiceFieldRef.current;
              const v = pendingFieldValueRef.current.trim();
              if (f && v) applyTableFieldRef.current(f, v);
              pendingFieldValueRef.current = '';
              activeVoiceFieldRef.current = null;
            } else {
              // Handle any text before the first keyword
              if (kwHits[0].pos > 0) {
                // Text before first keyword continues the previously active field
                const before = seg.slice(0, kwHits[0].pos).trim();
                if (activeVoiceFieldRef.current && before) {
                  pendingFieldValueRef.current = (pendingFieldValueRef.current + ' ' + before).trim();
                }
                const f = activeVoiceFieldRef.current;
                const v = pendingFieldValueRef.current.trim();
                if (f && v) applyTableFieldRef.current(f, v);
              } else {
                // Segment starts with a keyword — flush any prior pending field
                const prevField = activeVoiceFieldRef.current;
                const prevValue = pendingFieldValueRef.current.trim();
                if (prevField && prevValue) applyTableFieldRef.current(prevField, prevValue);
              }
              pendingFieldValueRef.current = '';
              activeVoiceFieldRef.current = null;

              // Apply every keyword→value pair found in this segment.
              // Each is closed by the trailing "period" (or by the next keyword in the segment).
              // EXCEPTION: "description" swallows the REST of the segment — its
              // value runs to the closing "period", so narration words that
              // double as field keywords never chop it up.
              for (let ki = 0; ki < kwHits.length; ki++) {
                const { pos, kw, fk } = kwHits[ki];
                const valueStart = pos + kw.length;
                const isDescription = fk === 'customDescription';
                const valueEnd = (!isDescription && ki + 1 < kwHits.length) ? kwHits[ki + 1].pos : seg.length;
                const value = seg.slice(valueStart, valueEnd).trim();
                if (value) applyTableFieldRef.current(fk, value);
                if (isDescription) break; // everything after belonged to the description
              }
              pendingFieldValueRef.current = '';
              activeVoiceFieldRef.current = null;
            }
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
        } else if (activeVoiceFieldRef.current === 'customDescription') {
          // Mid-description, no period yet — keyword lookalikes ("sleeve",
          // "style"…) are narration; keep accumulating until "period".
          pendingFieldValueRef.current = (pendingFieldValueRef.current + ' ' + final.trim()).trim();
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
        // Real-time column highlighting from interim text. Never switch away
        // from an in-progress description — its narration words ("sleeve",
        // "style"…) are not commands until "period" closes it.
        if (activeVoiceFieldRef.current !== 'customDescription') {
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
    // setProcessedItems is a stable store setter — listed to satisfy exhaustive-deps.
  }, [currentGroupIndex, setProcessedItems]);

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

      // Collect patches as a Map<itemId, updatedItem> so we can apply them
      // via functional update (prevents stale-closure from overwriting freshly
      // DB-hydrated seoTitle / voiceDescription / productType).
      const patches = new Map<string, ClothingItem>();

      // Read the CURRENT items snapshot at the time the async work starts.
      // We'll use a functional update below so concurrent state changes are safe.
      const snapshot = processedItemsRef.current;

      // Group items by productGroup
      const productGroups = snapshot.reduce((groups, item) => {
        const groupId = item.productGroup || item.id;
        if (!groups[groupId]) groups[groupId] = [];
        groups[groupId].push(item);
        return groups;
      }, {} as Record<string, ClothingItem[]>);

      // Apply presets to each group that has a category but no preset data
      for (const [, groupItems] of Object.entries(productGroups)) {
        const firstItem = groupItems[0];

        // Skip if no category assigned
        if (!firstItem.category) continue;

        // Skip if productType is a DB-persisted override (differs from category).
        // This is the same signal used by the per-group auto-apply effect so we
        // never clobber a manually-selected override on reload.
        const hasProductTypeOverride = groupItems.some(item =>
          item.productType &&
          item.productType.toLowerCase() !== (item.category || '').toLowerCase()
        );
        if (hasProductTypeOverride) continue;

        // Check if preset is already applied for this category
        const hasPresetData = groupItems.some(item => item._presetData);
        const presetCategory = groupItems.find(item => item._presetData)?._presetData?.productType;
        const isSameCategory = presetCategory?.toLowerCase() === firstItem.category?.toLowerCase();
        const hasPresetFields = groupItems.some(item =>
          item.policies || item.shipsFrom || item.gender || item.whoMadeIt
        );

        // Skip if preset already applied for this exact category
        if (hasPresetData && hasPresetFields && isSameCategory) continue;

        try {
          // Apply preset to this group
          const updatedGroup = await applyPresetToProductGroup(groupItems, firstItem.category);
          updatedGroup.forEach((updatedItem) => patches.set(updatedItem.id, updatedItem));
        } catch (error) {
          // Silently fail for this group, continue with others
        }
      }

      if (patches.size === 0) return;

      // (isResettingRef suppression removed — the edit→onProcessed→prop→reset
      // feedback loop it guarded against no longer exists; the store is the
      // single source of truth and this functional update merges onto it.)

      // Functional update: merge patches onto the LATEST state so we never
      // overwrite fields (seoTitle, voiceDescription, productType override) that
      // arrived via DB hydration after this async task started.
      setProcessedItems(prev => {
        const next = prev.map(item => {
          const patch = patches.get(item.id);
          if (!patch) return item;
          // Re-check override on the LATEST item (prev), not the stale snapshot.
          const latestHasOverride =
            item.productType &&
            item.productType.toLowerCase() !== (item.category || '').toLowerCase();
          if (latestHasOverride) return item; // skip — DB-hydrated override arrived
          // The patch was built from a stale pre-hydration snapshot, so any field
          // that was undefined in the snapshot but populated by DB hydration will
          // be undefined in patch. We must prefer the LATEST item value for ALL
          // user-entered / DB-hydrated fields, not just seoTitle/voiceDescription.
          return {
            ...patch,
            // Text content (user-generated / AI-generated)
            seoTitle:             item.seoTitle             || patch.seoTitle,
            voiceDescription:     item.voiceDescription     || patch.voiceDescription,
            generatedDescription: item.generatedDescription || patch.generatedDescription,
            // Identity / vendor fields — DB-hydrated, never overwrite with stale snapshot
            brand:            item.brand            || patch.brand,
            // Voice-entered product attributes
            size:             item.size             || patch.size,
            color:            item.color            || patch.color,
            secondaryColor:   item.secondaryColor   || patch.secondaryColor,
            material:         item.material         || patch.material,
            era:              item.era              || patch.era,
            condition:        item.condition        || patch.condition,
            flaws:            item.flaws            || patch.flaws,
            care:             item.care             || patch.care,
            measurements:     item.measurements     || patch.measurements,
            modelName:        item.modelName        || patch.modelName,
            modelNumber:      item.modelNumber      || patch.modelNumber,
            // Pricing / inventory — user-entered or fetched
            price:            item.price            || patch.price,
            compareAtPrice:   item.compareAtPrice   || patch.compareAtPrice,
            sku:              item.sku              || patch.sku,
            barcode:          item.barcode          || patch.barcode,
          };
        });
        return next;
      });
    };

    applyPresetsToAllGroups();
    // setProcessedItems is a stable store setter — listed to satisfy exhaustive-deps.
  }, [availablePresets, setProcessedItems]); // Run when presets load

  // Auto-apply default preset when current group changes OR when category changes.
  // SKIP if productType already encodes a manual override (productType is saved to DB
  // and restored by mergeDB, so it survives refresh even when _presetData is absent).
  useEffect(() => {
    const autoApplyDefaultPreset = async () => {
      if (!currentItem || !currentItem.category) return;

      const hasPresetData = currentGroup.some(item => item._presetData);
      const presetCategory = currentGroup.find(item => item._presetData)?._presetData?.productType;
      const isSameCategory = presetCategory?.toLowerCase() === currentItem.category?.toLowerCase();
      const hasPresetFields = currentGroup.some(item =>
        item.policies || item.shipsFrom || item.gender || item.whoMadeIt
      );

      // Direct string comparison: if productType differs from category, it's a manual
      // override saved to DB. No preset-ID comparison needed — that was the bug (both
      // lookups could resolve to the same preset when category_name matched loosely).
      const productTypeIsOverride =
        !!currentItem.productType &&
        currentItem.productType.toLowerCase() !== currentItem.category.toLowerCase();
      const productTypePreset = productTypeIsOverride
        ? availablePresets.find(p =>
            p.is_active &&
            (p.product_type?.toLowerCase() === currentItem.productType!.toLowerCase() ||
             p.category_name.toLowerCase() === currentItem.productType!.toLowerCase())
          )
        : undefined;

      // Convenience for logging
      const defaultPresetForCategory = availablePresets.find(p =>
        p.is_active && p.is_default &&
        (p.product_type?.toLowerCase() === currentItem.category?.toLowerCase() ||
         p.category_name.toLowerCase() === currentItem.category?.toLowerCase())
      );

      console.log('[PRESET AUTO-APPLY] group', currentGroupIndex, {
        itemId: currentItem.id,
        category: currentItem.category,
        productType: currentItem.productType,
        productTypeIsOverride,
        hasPresetData,
        presetCategory,
        isSameCategory,
        hasPresetFields,
        selectedPresetId,
        productTypePresetName: productTypePreset?.display_name,
        defaultPresetName: defaultPresetForCategory?.display_name,
      });

      // Already applied for this exact category — nothing to do
      if (hasPresetData && hasPresetFields && isSameCategory) {
        console.log('[PRESET AUTO-APPLY] skip — already applied for category');
        return;
      }

      // Manual override in-memory (selectedPresetId set this session)
      const manualPresetApplied =
        selectedPresetId &&
        currentGroup.some(item => item._presetData?.presetId === selectedPresetId);
      if (manualPresetApplied && isSameCategory) {
        console.log('[PRESET AUTO-APPLY] skip — in-memory selectedPresetId override');
        return;
      }

      // productType override persisted to DB — don't clobber with category default.
      // Even if no preset found for productType, still skip to avoid stomping the override.
      if (productTypeIsOverride) {
        if (productTypePreset) {
          console.log('[PRESET AUTO-APPLY] skip — productType encodes override:', productTypePreset.display_name);
          setSelectedPresetId(productTypePreset.id);
          setAppliedPresetLabel(productTypePreset.display_name);
        } else {
          console.log('[PRESET AUTO-APPLY] skip — productType override present but no matching preset found for:', currentItem.productType);
        }
        return;
      }

      // DB-persisted appliedPresetId: exact identity of the last-applied preset.
      // This is the primary guard for same-category preset switches (e.g. applying
      // "Mens Sweatshirts" when "Kids Sweatshirts" is the default for 'Sweatshirts').
      if (!hasPresetData && currentItem?.appliedPresetId) {
        const dbPreset = availablePresets.find(p => p.id === currentItem.appliedPresetId && p.is_active);
        if (dbPreset) {
          console.log('[PRESET AUTO-APPLY] skip — appliedPresetId from DB:', dbPreset.display_name);
          setSelectedPresetId(currentItem.appliedPresetId);
          setAppliedPresetLabel(dbPreset.display_name);
          return;
        }
      }

      // Fallback: no appliedPresetId (older saved items). If preset-owned fields
      // (policies, shipsFrom, gender, whoMadeIt) are present, a preset was previously
      // applied — skip auto-apply to avoid overwriting those values.
      if (!hasPresetData && hasPresetFields) {
        console.log('[PRESET AUTO-APPLY] skip — preset fields persisted from prior session (legacy guard)');
        return;
      }

      try {
        const categoryChanged = !isSameCategory && hasPresetData;
        console.log('[PRESET AUTO-APPLY] applying default preset for category:', currentItem.category, 'categoryChanged:', categoryChanged);
        const updatedGroup = await applyPresetToProductGroup(currentGroup, currentItem.category, categoryChanged);
        setProcessedItems(prev => {
          const updated = [...prev];
          updatedGroup.forEach((updatedItem) => {
            const itemIndex = updated.findIndex(item => item.id === updatedItem.id);
            if (itemIndex !== -1) {
              const prevItem = prev[itemIndex];
              // applyPresetToProductGroup was called with a possibly-stale currentGroup
              // (pre-hydration). Prefer the LATEST prev values for all user-entered /
              // DB-hydrated fields so we never overwrite brand/size/flaws/etc. that
              // arrived via DB hydration after the async fetch started.
              updated[itemIndex] = {
                ...updatedItem,
                seoTitle:             prevItem.seoTitle             || updatedItem.seoTitle,
                voiceDescription:     prevItem.voiceDescription     || updatedItem.voiceDescription,
                generatedDescription: prevItem.generatedDescription || updatedItem.generatedDescription,
                brand:          prevItem.brand          || updatedItem.brand,
                size:           prevItem.size           || updatedItem.size,
                color:          prevItem.color          || updatedItem.color,
                secondaryColor: prevItem.secondaryColor || updatedItem.secondaryColor,
                material:       prevItem.material       || updatedItem.material,
                era:            prevItem.era            || updatedItem.era,
                condition:      prevItem.condition      || updatedItem.condition,
                flaws:          prevItem.flaws          || updatedItem.flaws,
                care:           prevItem.care           || updatedItem.care,
                measurements:   prevItem.measurements   || updatedItem.measurements,
                modelName:      prevItem.modelName      || updatedItem.modelName,
                modelNumber:    prevItem.modelNumber    || updatedItem.modelNumber,
                price:          prevItem.price          || updatedItem.price,
                compareAtPrice: prevItem.compareAtPrice || updatedItem.compareAtPrice,
                sku:            prevItem.sku            || updatedItem.sku,
                barcode:        prevItem.barcode        || updatedItem.barcode,
                // Preserve a DB-hydrated productType override (differs from category)
                productType: (
                  prevItem.productType &&
                  prevItem.productType.toLowerCase() !== (prevItem.category || '').toLowerCase()
                ) ? prevItem.productType : updatedItem.productType,
                // Preserve a DB-hydrated appliedPresetId so hydration wins over auto-apply
                appliedPresetId: prevItem.appliedPresetId || updatedItem.appliedPresetId,
              };
            }
          });
          return updated;
        });
        if (defaultPresetForCategory) {
          setSelectedPresetId(defaultPresetForCategory.id);
          setAppliedPresetLabel(defaultPresetForCategory.display_name);
        }
      } catch (error) {
        // Silently fail auto-apply
      }
    };

    if (availablePresets.length > 0) autoApplyDefaultPreset();
  }, [currentGroupIndex, currentItem?.category, availablePresets, selectedPresetId]); // Watch category + manual preset changes

  // Keep the preset search label + selectedPresetId in sync when navigating groups.
  // Persistence chain after refresh (highest priority first):
  //   1. _presetData.presetId  — set in-memory when preset was applied this session
  //   2. productType preset lookup — productType IS written to DB (product_type col)
  //      so it survives refresh and can be matched back to the right preset
  //   3. empty string — no preset selected
  useEffect(() => {
    const fromPresetData = currentItem?._presetData?.presetId || '';
    // DB-persisted preset ID — primary persistence signal after reload
    const fromAppliedPreset = (!fromPresetData && currentItem?.appliedPresetId)
      ? (availablePresets.find(p => p.id === currentItem.appliedPresetId && p.is_active)?.id || '')
      : '';
    const fromProductType = (fromPresetData || fromAppliedPreset)
      ? ''
      : availablePresets.find(p =>
          p.is_active &&
          (p.product_type?.toLowerCase() === currentItem?.productType?.toLowerCase() ||
           p.category_name.toLowerCase() === currentItem?.productType?.toLowerCase())
        )?.id || '';
    const resolvedId    = fromPresetData || fromAppliedPreset || fromProductType;
    const resolvedLabel = availablePresets.find(p => p.id === resolvedId)?.display_name ||
      currentItem?._presetData?.displayName || '';

    console.log('[PRESET NAV] group', currentGroupIndex, {
      itemId: currentItem?.id,
      productType: currentItem?.productType,
      presetDataId: fromPresetData,
      productTypeLookupId: fromProductType,
      resolvedId,
      resolvedLabel,
      availablePresetsCount: availablePresets.length,
    });

    setSelectedPresetId(resolvedId);
    setAppliedPresetLabel(resolvedLabel);
    setPresetSearchQuery('');
    setPresetSearchOpen(false);
  }, [currentGroupIndex, availablePresets, currentItem?.productType]); // Re-run when presets load or hydration restores productType

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
        // force=true: user explicitly chose this preset, so reset stale preset-owned
        // fields (style, gender, tags, policies, etc.) and apply fresh values.
        // Voice/manual fields (brand, size, color, measurements, title) are kept.
        const updatedGroup = applyPresetDirectly(group, preset.product_type || preset.category_name, preset, true);
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
          // Use actual item size so voice re-extraction never produces garbled values
          size: latestItem.size || '',
          material: '',
          condition: undefined,
          era: '',
          style: '',
          gender: '',
          // Prefer the applied preset's productType so item type (sweatshirt vs tee etc.)
          // always reflects the preset, not the raw Step-2 category which may differ.
          category: (latestItem as any)._presetData?.productType || latestItem.category || latestItem.productType || '',
          presetTags: (latestItem as any)._presetData?.default_tags || [],
          measurements: undefined,
          flaws: '',
          care: ''
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
  //
  // Only syncs the CURRENT GROUP (the one the user just edited) — not all groups.
  // Syncing all groups on every navigation caused N parallel DB calls (one per group)
  // making every Next/Prev click noticeably slow on large batches.
  const handleSave = async () => {
    log.pdg(`handleSave | group=${currentGroupIndex} groupSize=${currentGroup.length} batchId=${batchId ?? 'none'}`);
    if (!currentGroup.length) { setHasUnsavedChanges(false); return; }
    try {
      await syncGroupFieldsToDatabase(currentGroup, batchId ?? null);
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

  /** fieldKey → the spoken label used in "label value period" transcript lines. */
  const FIELD_TO_VOICE_LABEL: Record<string, string> = {
    seoTitle: 'title', brand: 'brand', size: 'size', color: 'color',
    secondaryColor: 'second color', condition: 'condition', price: 'price',
    era: 'era', style: 'style', gender: 'gender', material: 'material',
    tags: 'tags', flaws: 'flaws', care: 'care', customDescription: 'description',
    meas_width: 'width', meas_length: 'length', meas_chest: 'chest',
    meas_waist: 'waist', meas_hip: 'hip', meas_rise: 'rise',
    meas_inseam: 'inseam', meas_outseam: 'outseam', meas_leg: 'leg opening',
    meas_sleeve: 'sleeve', meas_shoulder: 'shoulder',
  };

  /**
   * Surgically sync ONE field edit into the voice transcript: update the
   * existing "label value period" line if present, else append one. Everything
   * else in the transcript — especially freeform narration — is left intact.
   * (The old approach rebuilt the WHOLE transcript from structured fields,
   * which silently deleted any narration the moment a field changed.)
   */
  const patchVoiceLine = (text: string, fieldKey: string, value: string): string => {
    const label = FIELD_TO_VOICE_LABEL[fieldKey];
    if (!label) return text;
    const val = value.trim();
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRe = new RegExp(`^${esc}\\s+.*?(?:\\bperiod\\b|\\.)\\s*$`, 'im');
    if (!val) {
      // Field cleared — drop its stale line so Regenerate can't resurrect it
      return text.replace(lineRe, '').replace(/\n{2,}/g, '\n').trim();
    }
    const newLine = `${label} ${val} period`;
    if (lineRe.test(text)) return text.replace(lineRe, newLine);
    return text.trim() ? `${text.trimEnd()}\n${newLine}` : newLine;
  };

  /** Handle a cell edit from the VoiceCommandTable — updates fields AND rebuilds voiceDescription */
  const handleTableFieldChange = (fieldKey: string, value: string) => {
    console.log('[PDG] handleTableFieldChange', { fieldKey, value, currentGroupIndex });
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
      // Sync this ONE edit into the transcript, preserving all narration
      updated = { ...updated, voiceDescription: patchVoiceLine(updated.voiceDescription || '', fieldKey, value) };
      return updated;
    }));

    // Immediately schedule a direct save — bypasses the processedItems→onProcessed→prop feedback loop
    // that was causing isResettingRef to block the debounce save effect.
    const updatedGroup = currentGroup.map(groupItem => {
      const item = processedItems.find(i => i.id === groupItem.id) ?? groupItem;
      if (!targetIds.has(item.id)) return item;
      let updated: ClothingItem;
      if (fieldKey.startsWith('meas_')) {
        const measKey = fieldKey.slice(5);
        updated = { ...item, measurements: { ...(item.measurements || {}), [measKey]: value } };
      } else if (fieldKey === 'price') {
        const directNum = parseFloat(value.replace(/[^0-9.]/g, ''));
        updated = { ...item, price: isNaN(directNum) ? undefined : directNum };
      } else if (fieldKey === 'tags') {
        updated = { ...item, tags: value.split(/,\s*/).filter(Boolean) };
      } else {
        updated = { ...item, [fieldKey]: value };
      }
      return { ...updated, voiceDescription: patchVoiceLine(updated.voiceDescription || '', fieldKey, value) };
    });
    console.log('[PDG] handleTableFieldChange → debouncedDirectSave with updatedGroup[0]:', {
      id: updatedGroup[0]?.id,
      [fieldKey]: (updatedGroup[0] as any)[fieldKey],
    });
    debouncedDirectSave(updatedGroup);
  };

  // Keep applyTableFieldRef current every render
  applyTableFieldRef.current = handleTableFieldChange;

  // ── Quick descriptor keyword chips ─────────────────────────────────────
  // Founder-curated from the descriptor_chips table; hardcoded list is the
  // fallback when the table is missing (migration not run) or empty.
  const [chipDefs, setChipDefs] = useState<{ label: string; output: string }[]>(
    DESCRIPTOR_KEYWORDS.map(k => ({ label: k, output: k }))
  );
  useEffect(() => {
    let cancelled = false;
    fetchActiveChips().then(res => {
      if (cancelled || res.status !== 'ok' || res.chips.length === 0) return;
      setChipDefs(res.chips.map(c => ({ label: c.label, output: c.output_text || c.label })));
    });
    return () => { cancelled = true; };
  }, []);

  const descriptorActive = (kw: string): boolean => {
    const cur = (currentItem?.customDescription || '');
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z])${esc}(?:[^a-z]|$)`, 'i').test(cur);
  };

  const toggleDescriptorKeyword = (kw: string) => {
    const current = currentItem?.customDescription || '';
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let next: string;
    if (descriptorActive(kw)) {
      next = current
        .replace(new RegExp(`\\s*,?\\s*\\b${esc}\\b`, 'ig'), '')
        .replace(/^\s*,\s*/, '')
        .replace(/\s*,(\s*,)+/g, ',')
        .replace(/\s{2,}/g, ' ')
        .trim();
    } else {
      next = current.trim() ? `${current.trim().replace(/,\s*$/, '')}, ${kw}` : kw;
    }
    // Reuses the normal field-edit path: group-wide update, transcript line
    // patch, debounced direct save — chips are just a fast way to type.
    handleTableFieldChange('customDescription', next);
  };

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
      //   Priority: manually selected override (selectedPresetId) → default for item.category.
      let latestGroup = group;
      {
        const freshPresets = await getCategoryPresets();

        // Priority order for preset to use during regeneration:
        // 1. selectedPresetId — in-memory manual override (set this session, or restored by nav effect)
        // 2. item.productType lookup — productType is saved to DB so it survives refresh
        // 3. default preset for item.category — category-level fallback
        const bySelectedId = selectedPresetId
          ? freshPresets.find(p => p.id === selectedPresetId && p.is_active)
          : null;
        const byProductType = !bySelectedId && item.productType
          ? freshPresets.find(p =>
              p.is_active &&
              (p.product_type?.toLowerCase() === item.productType!.toLowerCase() ||
               p.category_name.toLowerCase() === item.productType!.toLowerCase())
            )
          : null;
        const byCategory = (!bySelectedId && !byProductType && item.category)
          ? freshPresets.find(p =>
              p.is_active && p.is_default &&
              (p.product_type?.toLowerCase() === item.category!.toLowerCase() ||
               p.category_name.toLowerCase() === item.category!.toLowerCase())
            ) ??
            freshPresets.find(p =>
              p.is_active &&
              (p.product_type?.toLowerCase() === item.category!.toLowerCase() ||
               p.category_name.toLowerCase() === item.category!.toLowerCase())
            )
          : null;
        const matchingPreset = bySelectedId ?? byProductType ?? byCategory ?? null;

        console.log('[PRESET REGEN] Step 0 preset resolution', {
          itemId: item.id,
          category: item.category,
          productType: item.productType,
          selectedPresetId,
          bySelectedIdName: bySelectedId?.display_name,
          byProductTypeName: byProductType?.display_name,
          byCategoryName: byCategory?.display_name,
          resolvedPresetName: matchingPreset?.display_name,
        });

        if (matchingPreset) {
          // Use the matched preset's productType as the authoritative category for title/tag generation.
          const effectiveCategory = matchingPreset.product_type || matchingPreset.category_name || item.category || '';
          latestGroup = applyPresetDirectly(group, effectiveCategory, matchingPreset);
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

      // Founder-curated brand words (brand_keywords table) — merged into the
      // generated tags like preset tags. Best-effort; [] when absent/unavailable.
      const brandTerms = await getBrandTerms(refreshedItem.brand);

      const aiResult = await generateProductDescription({
        voiceDescription: voiceText || undefined,
        title: refreshedItem.seoTitle || '',
        // Pass actual item fields as fallbacks — voice extraction wins via merge order in textAIService
        brand:     refreshedItem.brand     || '',
        color:     refreshedItem.color     || '',
        size:      refreshedItem.size      || '',
        material:  refreshedItem.material  || '',
        condition: refreshedItem.condition as any || undefined,
        era:       refreshedItem.era       || '',
        style:     refreshedItem.style     || '',
        gender:    refreshedItem.gender    || '',
        modelName: refreshedItem.modelName || '',
        type:      refreshedItem.productType || '',
        // Prefer the applied preset's productType so item type (sweatshirt vs tee etc.)
        // always reflects the preset, not the raw Step-2 category which may differ.
        category: (refreshedItem as any)._presetData?.productType || refreshedItem.category || refreshedItem.productType || '',
        presetTags: (refreshedItem as any)._presetData?.default_tags || [],
        brandTerms,
        descriptionSettings: descriptionSettings ?? undefined,
        customDescription: refreshedItem.customDescription || '',
        measurements: refreshedItem.measurements || undefined,
        flaws: refreshedItem.flaws || '',
        care:  refreshedItem.care  || ''
      });

      console.log('[REGEN] aiResult', {
        suggestedTitle: aiResult.suggestedTitle,
        description: aiResult.description?.slice(0, 80),
        extractedFields: aiResult.extractedFields,
        voiceTextUsed: voiceText?.slice(0, 80),
        refreshedItemSeoTitle: refreshedItem.seoTitle,
        refreshedItemCategory: refreshedItem.category,
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
            // Sync seoTitle with freshly generated title (always overwrite AI-generated titles;
            // user can type in the title field directly if they want a custom value)
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
            ...(extractedFields.customDescription && { customDescription: extractedFields.customDescription }),
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
      // Immediately flush to DB so a page refresh never loses the generated description
      const updatedGroupForSave = currentGroup.map(gi => {
        const found = targetIds.has(gi.id);
        if (!found) return gi;
        return {
          ...gi,
          generatedDescription: finalDescription,
          ...(aiResult.suggestedTitle && { seoTitle: aiResult.suggestedTitle }),
        };
      });
      console.log('[REGEN] Flushing to DB immediately:', {
        id: updatedGroupForSave[0]?.id,
        seoTitle: updatedGroupForSave[0]?.seoTitle,
        generatedDescription: updatedGroupForSave[0]?.generatedDescription?.slice(0, 80),
      });
      syncGroupFieldsToDatabase(updatedGroupForSave, batchId ?? null).catch((e) => console.error('[REGEN] immediate save threw:', e));
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

  // Keyboard: close lightbox or crop modal on Escape; Enter toggles voice recording
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
      // Enter/Return toggles voice recording when not focused on a text input
      if (e.key === 'Enter' && !lightboxSrc && !cropModal.open) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault();
          if (isRecording) {
            handleStopRecording();
          } else {
            handleStartRecording();
          }
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lightboxSrc, lightboxItemId, lightboxPool, cropModal.open, isRecording, isTransitioning]);

  // Duplicate title check — debounced, cross-batch Supabase query
  useEffect(() => {
    const title = currentItem?.seoTitle?.trim();
    if (!title) { setDuplicateTitleWarning(false); return; }
    const currentId = currentItem?.id;
    const t = setTimeout(async () => {
      try {
        const { supabase } = await import('../lib/supabase');
        let query = supabase
          .from('products')
          .select('id')
          .ilike('seo_title', title);
        if (currentId) query = query.neq('id', currentId);
        const { data } = await query.limit(1);
        setDuplicateTitleWarning(!!(data && data.length > 0));
      } catch { setDuplicateTitleWarning(false); }
    }, 800);
    return () => clearTimeout(t);
  }, [currentItem?.seoTitle, currentItem?.id]);

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
          {/* Navigation — moved to the TOP of the column (user request): Prev/Next,
              group slider, and Download CSV are reachable without scrolling. */}
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
          {groupArray.length > 1 && (
            <input
              type="range"
              className="group-nav-slider"
              min={0}
              max={groupArray.length - 1}
              step={1}
              value={currentGroupIndex}
              onChange={e => {
                const idx = Number(e.target.value);
                if (hasUnsavedChanges) handleSave();
                setCurrentGroupIndex(idx);
              }}
              title={`Jump to group ${currentGroupIndex + 1} of ${groupArray.length}`}
            />
          )}
          {onDownloadCSV && (
            <button
              className="button"
              onClick={onDownloadCSV}
              style={{
                margin: '0.5rem 0',
                width: '100%',
                justifyContent: 'center',
                fontSize: '0.8125rem',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              }}
            >
              💾 Download CSV
            </button>
          )}

          {/* Scrollable area — image, thumbnails, magnifier controls. */}
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
                max={700}
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

              {/* Quick keywords — tap to add/remove resale descriptors from the
                  description field (no need to know or dictate the vocabulary) */}
              <div className="descriptor-chips">
                <span className="descriptor-chips-label">Quick keywords</span>
                {chipDefs.map(chip => {
                  const active = descriptorActive(chip.output);
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      className={`descriptor-chip ${active ? 'descriptor-chip--on' : ''}`}
                      onClick={() => toggleDescriptorKeyword(chip.output)}
                      title={active ? `Remove "${chip.output}" from the description` : `Add "${chip.output}" to the description`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
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
                        const mch = measV('chest');          if (mch) meas.width = meas.width || mch;
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
              {duplicateTitleWarning && (
                <p style={{ fontSize: '0.78rem', color: '#dc2626', margin: '0.25rem 0 0', fontWeight: 600 }}>
                  ⚠️ Duplicate title — this title already exists in another batch on Shopify
                </p>
              )}
            </div>

            {/* Generated description — sits directly below the voice box */}
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
                Generated Description:
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
                  title="Re-extract all fields from voice + description, then regenerate listing"
                >
                  {isGenerating ? '🧠 Regenerating…' : '🔄 Regenerate Description'}
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
                  title="Clear the generated description"
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
                Reads voice &amp; description → updates all fields → writes a new description
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

            {/* Category Preset Applied Indicator — shows when preset is applied either
                in-memory (_presetData) or restored post-refresh via productType lookup
                (appliedPresetLabel is set by the nav effect in both cases) */}
            {(currentItem._presetData || appliedPresetLabel) && (
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
                  <div><strong>Category:</strong> {appliedPresetLabel || currentItem._presetData?.displayName}</div>
                  {(() => {
                    const activePreset = availablePresets.find(p => p.id === selectedPresetId);
                    const desc = activePreset?.description || currentItem._presetData?.description;
                    return desc ? <div style={{ color: '#666', fontStyle: 'italic' }}>{desc}</div> : null;
                  })()}
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
