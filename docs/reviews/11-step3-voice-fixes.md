# 11 — Step 3 voice / preset / export defects: implementation log

Six founder reports (3, 4, 5, 7, 8, 10) against Step 3 (dictation → fields →
generated description → CSV). Every root cause was traced in the current source
before anything changed. Nothing was committed.

`src/lib/imageTransforms.ts` and `src/components/ImageGrouper.tsx` belong to a
concurrent agent and were not touched.

---

## The one structural change

The dictation parser used to live inline in `ProductDescriptionGenerator`'s
`recognition.onresult` — ~230 lines of segment-splitting inside a speech callback,
untestable, and the origin of reports 4, 7 and 10. It is now
**`src/lib/voiceGrammar.ts`**: pure functions, a documented grammar, 42 tests.

The component keeps the recogniser lifecycle and the writes; the module owns the
language. Moved in with it: the vocabulary (`VOICE_KEYWORD_TO_FIELD`, re-exported
from `VoiceCommandTable` so existing imports are unchanged), `fixTranscript`, and
`patchVoiceLine`.

---

## Per report

### 3 — "category isn't sticking… gets reset to previous or unrelated preset" — **CONFIRMED**

**Root cause, two halves.**

*The category.* `applyPresetFields` (`src/lib/applyPresetToGroup.ts:135`) always
writes `category: categoryName` — its second argument. Step 3 passed the
**preset's** type there, not the listing's category:

- `handleApplyPreset` — `applyPresetDirectly(group, preset.product_type || preset.category_name, preset, true)`
- `handleRegenerateAll` Step 0 — `effectiveCategory = matchingPreset.product_type || …`

So picking a preset overwrote the Step-2 category with the preset's product_type
(`sweatshirts` → `Mens Sweatshirts`), and every regeneration rewrote it again.
`CategoryZones` has always passed the real category — Step 3 was the outlier.

*The unrelated preset.* That overwrite also destroyed the signal the auto-apply
guards depend on. `productTypeIsOverride` (PDG:~900) is
`productType.toLowerCase() !== category.toLowerCase()` — once the preset had set
both to its own product_type, the manual choice became invisible. Regeneration then
re-resolved from scratch through a chain of bare `.find()` calls that ignored
`is_default` and never consulted `appliedPresetId`, so with two presets sharing a
product_type it returned whichever row the DB listed first — and re-applied it.
Because `handleRegenerateAll` runs on **every Stop Recording**, the drift was
observed "when dictating".

**Fix.**
- Both call sites pass the listing's own category; the preset's type still reaches
  generation via `productType` / `_presetData.productType`, where it belongs.
- Step 0 resolves most-explicit-first: `selectedPresetId` → `item.appliedPresetId`
  → `resolvePreset(presets, item.productType)` → `resolvePreset(presets, item.category)`.
  Steps 3–4 now go through the shared `lib/presetResolver` (product_type + is_default
  first) instead of ad-hoc `.find()`.

**Edge cases.** Group with no category yet → falls back to the preset name (old
behaviour). Legacy rows with no `appliedPresetId` (the root-level
`ADD_APPLIED_PRESET_ID.sql` may be unrun) → the productType step still resolves,
now preferring the default. Two presets sharing a product_type → the default wins
deterministically. `force=true` still resets preset-owned fields.

**Tests.** `applyPresetToGroup.test.ts` +5 — category preserved while productType
comes from the preset; the override signal survives; the bug shape kept as
documentation; preset identity recorded; `resolvePreset` prefers the default over
an arbitrary first match.

---

### 4 — "input times out, needs to wait for period" — **CONFIRMED** (see grammar below)

Three separate ways speech was lost:

1. **Nothing was written without "period".** A value only reached a field when a
   `period` segment closed it; otherwise it sat in `pendingFieldValueRef` forever.
2. **Stop discarded it.** `handleStopRecording` did
   `pendingFieldValueRef.current = ''` with no flush — an un-terminated
   description was deleted at the moment the user stopped talking.
3. **Navigation aborted mid-utterance.** The recogniser effect was keyed on
   `[currentGroupIndex, …]`; its cleanup called `.abort()`, so Next/Prev tore the
   session down and dropped whatever was open.

The browser's own silence timeout was *not* the loss mechanism — `onend` already
restarted the recogniser, and the parser state is a ref that survives the gap. It
was the three above.

**Fix.** The new grammar (below) ends a command at the next field title; the tail
of every utterance is written optimistically and re-written fuller as more speech
arrives; `flushVoiceState` commits on Stop, on the period boundary and on
navigation; the recogniser effect is mount-stable and reads the group index
through `currentGroupIndexRef`, so it survives navigation instead of aborting.

**Edge case found and fixed while doing it:** a value flushed *during* navigation
would have landed on the listing the user just moved to, because
`applyTableFieldRef` is reassigned every render. `voiceStateGroupRef` records the
listing the command was spoken over and `handleTableFieldChange` takes an explicit
group index, so a flush always writes where the words were said.

---

### 5 — "press period instead of saying period" — implemented

`commitVoiceBoundary()` = `flushVoiceState` + apply, identical to the spoken word.
Bound to the **`.` key** and `NumpadDecimal` (window `keydown`, only while
recording, skipped when an `INPUT`/`TEXTAREA`/`SELECT`/contenteditable has focus so
it never eats a typed decimal, and skipped with a modifier held). Also a **Period
button** beside Start/Stop, visible while recording — `.voice-period-btn`, 44×44 px
minimum under `max-width: 768px`.

---

### 7 — "description isn't picked up on some things" — **CONFIRMED**, two causes

1. The same "never written without a period" problem as report 4.
2. **`handleStopRecording` never applied `extractedFields.customDescription`.**
   Its field-application block lists brand, model, colour, size, material,
   condition, era, style, gender, measurements, price, flaws, care, seoTitle and
   tags — `customDescription` is absent (`handleRegenerateAll`'s equivalent block
   has it). A dictated description only landed if the regeneration that follows
   happened to run and succeed; when it early-returned or threw, the description
   was silently dropped.

**Fix.** `customDescription` added to that block; the grammar writes descriptions
without needing a period; Stop flushes.

**Not changed:** the no-period fallback lookahead in `extractFieldsFromVoice:165`
omits `type`/`chest`/`hip`/`rise`. Adding them would make descriptions *more*
likely to be chopped at a narration word — the exact regression the July 2026
voice overhaul fixed. Left alone deliberately.

---

### 8 — "edited inputs are not persisting upon editing original inputs" — **CONFIRMED**, three causes

1. **`patchVoiceLine` ate its neighbours.** The old line regex was
   `^label\s+.*?(?:\bperiod\b|\.)\s*$` — lazy, but anchored to end-of-line, so
   `.*?` expanded to the *last* terminator on the line. `formatVoiceTranscript`'s
   trigger list does not include `description`, so a description shares a line
   with the command before it. Measured against the pre-fix source:

   ```
   patchVoiceLine("brand nike. description super soft long sleeve.", "brand", "Champion")
     old → "brand Champion period"                                    ← description destroyed
     new → "brand Champion period description super soft long sleeve."
   ```

   Editing the brand deleted the description from the transcript; the next
   Regenerate re-extracted from the mutilated transcript and the description was
   gone for good.

2. **The direct save carried a stale group.** `handleTableFieldChange` rebuilt
   `updatedGroup` from the render-captured `processedItems`, not the store. When one
   spoken chunk writes several fields in one tick (`brand nike size large price forty`),
   every call saw the same pre-edit snapshot, so the last one won and the DB row was
   written *without* the other fields. It also held a **second copy** of the field
   mapping that had drifted: spoken-word prices ("forty five") parsed to `45` for the
   store and to `undefined` for the save.

3. **The post-regeneration flush carried a stale group.** `handleRegenerateAll` built
   `updatedGroupForSave` from the render-captured `currentGroup` — captured *before*
   the preset refresh and the voice extraction it had just performed. It saved the
   generated text alongside pre-extraction values for every other column, reverting
   brand/size/colour in the DB.

**Fix.** `patchVoiceLine` rewritten as a span replacement over scanned field titles:
the span ends at the first terminator **or** the next field title, whichever comes
first, so it can never reach past its own command. Both save paths now read the
group back out of `processedItemsRef` (a live store view, fresh the instant the
setter returns), which also deletes the drifted duplicate mapping.

**Edge cases.** `size 10.5 period` — a decimal point is not a terminator
(`\.(?=\s|$)`). The description is the one field whose span ignores intervening
titles, because its value legitimately contains them. Synonym titles (`colour`)
match by field key but are rewritten with the canonical label. Clearing a field
drops its line. Unknown field key is a no-op.

**Tests.** `voiceGrammar.test.ts` — 9 `patchVoiceLine` tests including the exact
repro above, a multi-line transcript left byte-identical, the decimal case, and a
four-edit round trip.

---

### 10 — "injecting the word 'description' instead of description values" — **CONFIRMED**

**Root cause.** The inline parser's description branch did not strip the spoken
title. While the user was still saying "description…", the interim-highlight pass
set `activeVoiceFieldRef.current = 'customDescription'`. The final chunk then hit
the description branch, which took the segment **verbatim**:

```js
if (activeVoiceFieldRef.current === 'customDescription') {
  const v = (pendingFieldValueRef.current + ' ' + seg).trim();   // seg still starts "description …"
  if (v) applyTableFieldRef.current('customDescription', v);
```

So `customDescription` became `"description super soft faded"`. Every consumer of
that field then carried the word: `generateTitleFromFields`' custom-description
title path (`textAIService.ts:1346`) built the title from its words, PART 1b
printed it into the description body, and `pullTagsFromDescription` scanned it.
Titles, tags and descriptions — exactly as reported. Every other field stripped
its title correctly, which is why only the description was affected.

The extractor was **not** at fault: `extractFieldsFromVoice` strips the title
properly (verified against six transcript shapes). The leak was upstream, in the
live pipeline, and once written it was sticky — re-extraction from
`description description super soft period` returns `description super soft`.

**Fix.** The grammar strips the matched title on **every** path, description
included. Plus a healing pass for data already corrupted by past sessions:
`stripLeadingFieldTitle` removes a leading `description`/`note` from
`customDescription` in `generateProductDescription`'s merge — one place, covering
title, body and tags.

**Edge cases.** Only the leading word is removed, so "great description on the tag"
survives. A value that was nothing but the title collapses to `undefined` rather
than an empty string. The golden description and CSV snapshots are unchanged.

**Tests.** `voiceGrammar.test.ts` — title stripped on the fresh path, on the
already-open path, and never emitted alone. `textAIService.test.ts` +6 — the
healing pass, and an assertion that no generated title or body contains the word.
Plus an end-to-end chain test (speech → parse → patch → format → extract →
generate) asserting it reaches neither title, tags nor body.

---

## The grammar (features 4 and 5)

Documented in full in the comment block at the head of `src/lib/voiceGrammar.ts`.

```
command  := <field title> <value> <boundary>
boundary := "period"            (spoken, or the "." key / the Period button)
          | <field title>       (the next command starts — no period needed)
          | <end of utterance>  (value written optimistically, field stays open)

description := "description" <everything> <description-boundary>
description-boundary := "period"
                      | a NEW UTTERANCE opening with a field title followed by a
                        plausible value
                      | (never: a field title mid-utterance)
```

- **Field titles are the `VOICE_KEYWORD_TO_FIELD` keys**, matched on **word
  boundaries**, longest-match-first, non-overlapping. The old parser used bare
  `indexOf`/`lastIndexOf`, so "vin**tag**e" activated tags, "over**size**d"
  activated size and "s**care**d" activated care.
- **"brand nike size large price forty" writes three fields with no periods.**
- **A value spoken across two results still accumulates** — the end-of-utterance
  write is optimistic and is replaced, fuller, when more speech arrives.
- **"Plausible value"** = at least one word after the title, and for a measurement
  title a word containing a digit. That is what separates `length 28` (a command
  that ends a description) from `length of the sleeve` (narration that continues
  it). Checked *before* "period", so `"brand nike period"` after an open
  description starts a command rather than being swallowed by it.
- **The title is never part of the value**, on any path.
- **Nothing is discarded.** `flushVoiceState` runs on Stop, on the "." key, on the
  Period button and on navigation.

---

## Files

| File | Change |
|---|---|
| `src/lib/voiceGrammar.ts` | **new** — grammar, vocabulary, `fixTranscript`, `patchVoiceLine` |
| `src/lib/voiceGrammar.test.ts` | **new** — 42 tests |
| `src/components/ProductDescriptionGenerator.tsx` | `onresult` 230 → 60 lines; period key + button; preset resolution; both save paths; stop-flush; `customDescription`; mount-stable recogniser |
| `src/components/VoiceCommandTable.tsx` | vocabulary moved to the lib (re-exported); status copy |
| `src/lib/textAIService.ts` | `stripLeadingFieldTitle` + merge-time healing |
| `src/lib/textAIService.test.ts` | +6 |
| `src/lib/applyPresetToGroup.test.ts` | +5 |
| `src/components/ProductDescriptionGenerator.css` | `.voice-period-btn` (44 px on phones) |

`applyPresetToGroup.ts`, `presetResolver.ts`, `csvExport.ts`, `productService.ts`
were read but needed no change — reports 3 and 8 were both call-site defects.

## Gates

| Gate | Before | After |
|---|---|---|
| `npm test` | 579 passed | **662 passed**, 41 files (+53 mine, +30 a concurrent agent's) |
| `npm run build` | clean | **clean** (`tsc -b && vite build`) |
| `npx eslint .` | **254 problems** | **252 problems** |
| `ProductDescriptionGenerator.tsx` | 24 | **23** |
| `VoiceCommandTable.tsx` | 13 | **12** |
| `textAIService.ts` | 14 | **14** |
| new files | — | **0** |
| golden snapshots (description, CSV) | — | **unchanged** |

No finding on a line this pass added. No synchronous `setState` in an effect body
and no ref write during render were introduced — the three new refs are assigned
in effects, and `voiceStateGroupRef` / `currentGroupIndexRef` are written only
from callbacks and effects.

## For the orchestrator

1. **`handleRegenerateAll` still re-applies a preset on every Stop Recording.**
   Now correct and non-destructive, but it is a network round trip plus a
   full-group patch per dictation. Collapsing it is a performance question, not a
   correctness one.
2. **`window.confirm` in `handleRegenerateAll`** (§18 #12) is pre-existing and was
   left alone.
3. **`applyTableFieldRef.current = handleTableFieldChange` is still a render-time
   ref write** (pre-existing, PDG:~1255). Not added to; worth retiring.
4. **CLAUDE.md updates the orchestrator owns:** §3 test coverage (add
   `voiceGrammar.test.ts`), §5 folder map (`src/lib/voiceGrammar.ts`), §10 Step 3
   (the grammar no longer requires "period"; `.` key and Period button), and §15
   (the "Voice description overhaul" entry now has a successor).
