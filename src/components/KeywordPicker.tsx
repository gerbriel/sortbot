import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { Field } from './ui/Field';
import { RemovableChip } from './ui/Chip';
import './KeywordPicker.css';

/* ── KeywordPicker ──────────────────────────────────────────────────────────
   Step 3's type-to-autofill keyword control. It replaced a row of ~30 always-
   visible pills: the vocabulary is the same, it is just found by typing.

   THE PICKER OWNS NO DATA. ProductDescriptionGenerator keeps the vocabulary
   (descriptor_chips with the DESCRIPTOR_KEYWORDS fallback, plus the brand-only
   suggestions), the brand suggestion logic and the description text. The
   picker only asks three questions through its props: is this entry suggested,
   is this keyword in the description, and toggle it.

   It is an ARIA 1.2 combobox: focus stays in the input the whole time and the
   highlighted option is announced through aria-activedescendant, so several
   keywords can be added in a row without the caret ever leaving the field. */

export interface KeywordEntry {
  /** What the option shows. */
  label: string;
  /** What gets written into the description (and what `isApplied` tests). */
  output: string;
}

export interface KeywordPickerProps {
  entries: KeywordEntry[];
  isSuggested: (entry: KeywordEntry) => boolean;
  isApplied: (output: string) => boolean;
  onToggle: (output: string) => void;
  /** Rows shown before "Browse all". */
  limit?: number;
  className?: string;
}

type Row =
  | { kind: 'entry'; entry: KeywordEntry; suggested: boolean; applied: boolean }
  | { kind: 'custom'; text: string }
  | { kind: 'browse'; total: number };

const DEFAULT_LIMIT = 8;

export function KeywordPicker({
  entries, isSuggested, isApplied, onToggle, limit = DEFAULT_LIMIT, className,
}: KeywordPickerProps) {
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  // Custom keywords typed here have no vocabulary entry, so the picker keeps
  // them for the session; they only ever render while still in the description.
  const [customs, setCustoms] = useState<KeywordEntry[]>([]);

  // One list, deduped on the written text: brand-only suggestions and a
  // vocabulary chip can describe the same word.
  const vocabulary = useMemo(() => {
    const seen = new Set<string>();
    const out: { entry: KeywordEntry; suggested: boolean; index: number }[] = [];
    for (const entry of [...entries, ...customs]) {
      const key = entry.output.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ entry, suggested: isSuggested(entry), index: out.length });
    }
    return out;
  }, [entries, customs, isSuggested]);

  const q = query.trim().toLowerCase();

  const rows: Row[] = useMemo(() => {
    let ranked: typeof vocabulary;
    if (q) {
      // Exact, then suggested, then prefix, then substring. Stable within a tier.
      const scored = vocabulary
        .map(v => {
          const label = v.entry.label.toLowerCase();
          const output = v.entry.output.toLowerCase();
          const exact = label === q || output === q;
          const prefix = label.startsWith(q) || output.startsWith(q);
          const hit = prefix || label.includes(q) || output.includes(q);
          return { v, exact, prefix, hit };
        })
        .filter(s => s.hit);
      // An exact match always leads, so Enter on a fully typed word applies
      // that word and not a suggested phrase that merely contains it.
      scored.sort((a, b) =>
        Number(b.exact) - Number(a.exact)
        || Number(b.v.suggested) - Number(a.v.suggested)
        || Number(b.prefix) - Number(a.prefix)
        || a.v.index - b.v.index);
      ranked = scored.map(s => s.v);
    } else {
      ranked = [...vocabulary].sort((a, b) =>
        Number(b.suggested) - Number(a.suggested) || a.index - b.index);
      // Empty field: the brand's suggestions when there are any, so the first
      // thing shown is the most relevant; the full set is one click away.
      if (!expanded && ranked.some(v => v.suggested)) ranked = ranked.filter(v => v.suggested);
    }

    const shown = expanded ? ranked : ranked.slice(0, limit);
    const out: Row[] = shown.map(v => ({
      kind: 'entry', entry: v.entry, suggested: v.suggested, applied: isApplied(v.entry.output),
    }));

    const exact = q && vocabulary.some(v =>
      v.entry.label.toLowerCase() === q || v.entry.output.toLowerCase() === q);
    if (q && !exact) out.push({ kind: 'custom', text: query.trim() });

    const total = q ? ranked.length : vocabulary.length;
    if (!expanded && total > shown.length) out.push({ kind: 'browse', total });
    return out;
  }, [vocabulary, q, query, expanded, limit, isApplied]);

  const showList = open && rows.length > 0;
  const activeIndex = showList && highlight >= 0 && highlight < rows.length ? highlight : -1;

  // Outside click closes. A click inside the popup never blurs the input (it
  // cancels mousedown), so blur plus this listener cover every way out.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setExpanded(false);
        setHighlight(-1);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row visible inside the scrolling list.
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  function close() {
    setOpen(false);
    setExpanded(false);
    setHighlight(-1);
  }

  function apply(row: Row) {
    if (row.kind === 'browse') {
      setExpanded(true);
      setHighlight(-1);
      inputRef.current?.focus();
      return;
    }
    if (row.kind === 'custom') {
      const text = row.text;
      if (!vocabulary.some(v => v.entry.output.toLowerCase() === text.toLowerCase())) {
        setCustoms(prev => [...prev, { label: text, output: text }]);
      }
      onToggle(text);
    } else {
      onToggle(row.entry.output);
    }
    setQuery('');
    setHighlight(-1);
    setOpen(true);
    inputRef.current?.focus();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) { setOpen(true); return; }
        if (rows.length === 0) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setHighlight(h => {
          if (h < 0) return step === 1 ? 0 : rows.length - 1;
          return (h + step + rows.length) % rows.length;
        });
        return;
      }
      case 'Enter': {
        if (!showList) return;
        if (activeIndex >= 0) {
          e.preventDefault();
          apply(rows[activeIndex]);
        }
        return;
      }
      case 'Escape': {
        if (open) {
          e.preventDefault();
          close();
        } else if (query) {
          e.preventDefault();
          setQuery('');
        }
        return;
      }
      case 'Tab':
        // Leaves the field without applying anything; focus moves on normally.
        close();
        return;
      default:
    }
  }

  // Applied chips: vocabulary entries (and customs) currently in the description.
  const appliedEntries = vocabulary.filter(v => isApplied(v.entry.output)).map(v => v.entry);

  return (
    <div ref={rootRef} className={['kwp', className].filter(Boolean).join(' ')}>
      <div className="kwp-combo">
        <Field label="Keywords" className="kwp-field">
          {(f) => (
            <input
              {...f}
              ref={inputRef}
              type="text"
              role="combobox"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="done"
              placeholder="Add a keyword"
              aria-autocomplete="list"
              aria-expanded={showList}
              aria-controls={listId}
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              className={`${f.className} kwp-input`}
              value={query}
              onChange={(e) => {
                // Typing re-ranks the list, so the highlight returns to the top
                // match; an empty field pre-highlights nothing.
                setQuery(e.target.value);
                setHighlight(e.target.value.trim() ? 0 : -1);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onBlur={close}
              onKeyDown={onKeyDown}
            />
          )}
        </Field>

        {/* The listbox stays mounted (hidden when closed) so aria-controls
            always points at a real element. mousedown is cancelled so a click
            on a row never blurs the input. */}
        <div
          className="kwp-popup"
          data-open={showList ? 'true' : 'false'}
          hidden={!showList}
          onMouseDown={(e) => e.preventDefault()}
        >
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Keywords"
            className={['kwp-list', expanded ? 'kwp-list--all' : ''].filter(Boolean).join(' ')}
          >
            {rows.map((row, i) => {
              const selected = i === activeIndex;
              const common = {
                id: optionId(i),
                role: 'option' as const,
                'aria-selected': selected,
                'data-index': i,
                onMouseEnter: () => setHighlight(i),
                onClick: () => apply(row),
              };
              if (row.kind === 'browse') {
                return (
                  <li key="__browse" {...common} className="kwp-option kwp-option--browse">
                    Browse all ({row.total})
                  </li>
                );
              }
              if (row.kind === 'custom') {
                return (
                  <li key="__custom" {...common} className="kwp-option kwp-option--custom">
                    Add &ldquo;{row.text}&rdquo;
                  </li>
                );
              }
              return (
                <li
                  key={row.entry.output.toLowerCase()}
                  {...common}
                  className={['kwp-option', row.applied ? 'kwp-option--applied' : ''].filter(Boolean).join(' ')}
                  title={row.applied ? `Remove "${row.entry.output}" from the description` : undefined}
                >
                  <span className="kwp-check" aria-hidden="true">
                    {row.applied && <Check size={14} />}
                  </span>
                  <span className="kwp-option-label">{row.entry.label}</span>
                  {row.applied && <span className="ui-sr-only">, added</span>}
                  {row.suggested && <span className="kwp-tag">suggested</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {appliedEntries.length > 0 && (
        <ul className="kwp-applied ui-chip-group" aria-label="Keywords in the description">
          {appliedEntries.map(entry => (
            <li key={entry.output.toLowerCase()}>
              <RemovableChip
                size="sm"
                removeLabel={`Remove keyword ${entry.label}`}
                onRemove={() => onToggle(entry.output)}
              >
                {entry.label}
              </RemovableChip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
