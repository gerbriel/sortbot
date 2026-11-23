import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import ProductDescriptionGenerator from './ProductDescriptionGenerator';
import { mount, cleanup, click } from './ui/testUtils';
import { workflowStore } from '../lib/workflowStore';
import type { ClothingItem } from '../App';

/**
 * Step 3 voice help: the dictation instructions live behind the header's
 * "How dictation works" info button, not in a sentence and a side column.
 * Mount setup mirrors ProductDescriptionGenerator.speech.test.tsx.
 */

vi.mock('../lib/native/speech', () => ({
  isSpeechAvailable: vi.fn(async () => true),
  createSpeechRecognizer: vi.fn(() => ({
    kind: 'web', start: vi.fn(async () => {}), stop: vi.fn(async () => {}), abort: vi.fn(async () => {}),
  })),
}));
vi.mock('../lib/supabase', async () => {
  const { createSupabaseMock } = await import('../lib/testing/supabaseMock');
  return { supabase: createSupabaseMock() };
});
vi.mock('../lib/categoryPresetsService', () => ({ getCategoryPresets: vi.fn(async () => []) }));
vi.mock('../lib/productService', () => ({
  syncGroupFieldsToDatabase: vi.fn(async () => true),
  flushProductPatchKeepalive: vi.fn(() => false),
}));
vi.mock('../lib/vocabService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/vocabService')>();
  return {
    ...actual,
    fetchActiveChips: vi.fn(async () => []),
    getBrandTerms: vi.fn(async () => []),
    getAllBrandKeywordEntries: vi.fn(async () => []),
  };
});
vi.mock('./ResearchCard', () => ({ default: () => null }));
vi.mock('./ListingLabelsPicker', () => ({ default: () => null }));
vi.mock('./BrandSpelling', () => ({ default: () => null }));

const items: ClothingItem[] = [
  { id: 'a', productGroup: 'a', category: 'tees', preview: '', imageUrls: [] },
] as unknown as ClothingItem[];

async function flush() {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

function infoButton(container: HTMLElement): HTMLElement {
  const btn = container.querySelector<HTMLElement>('button[aria-label="How dictation works"]');
  if (!btn) throw new Error('info button not found');
  return btn;
}

function helpPanel(container: HTMLElement): HTMLElement {
  const id = infoButton(container).getAttribute('aria-controls');
  const panel = id ? document.getElementById(id) : null;
  if (!panel) throw new Error('help panel not found');
  return panel;
}

describe('ProductDescriptionGenerator voice help', () => {
  beforeEach(() => {
    workflowStore.reset();
    workflowStore.setState({ processedItems: items, sortedImages: items });
    vi.stubGlobal('alert', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('the header is just the title plus the info button; the panel starts closed', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    const head = container.querySelector<HTMLElement>('.voice-result-head');
    expect(head?.textContent).toContain('Voice description');
    expect(head?.textContent).not.toContain('the next field name ends it');
    expect(infoButton(container).getAttribute('aria-expanded')).toBe('false');
    expect(helpPanel(container).hidden).toBe(true);
    // Clear Fields stays in the header row.
    expect(head?.textContent).toContain('Clear Fields');
  });

  it('the info button opens the panel with the rule, the examples and the field reference', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    click(infoButton(container));
    const panel = helpPanel(container);
    expect(panel.hidden).toBe(false);
    expect(infoButton(container).getAttribute('aria-expanded')).toBe('true');
    const text = panel.textContent ?? '';
    expect(text).toContain('Say a field name, then its value.');
    expect(text).toContain('The next field name ends the one before it');
    expect(text).toContain('brand Nike size large price forty');
    expect(text).toContain('description super soft faded boxy fit period');
    const terms = Array.from(panel.querySelectorAll('dt')).map(d => d.textContent);
    expect(terms).toEqual(expect.arrayContaining(['brand', 'size', 'price', 'leg opening', 'title']));
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  it('no toggle is rendered and the transcript lives inside the panel', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    const head = container.querySelector<HTMLElement>('.voice-result-head');
    const headButtons = Array.from(head?.querySelectorAll('button') ?? []).map(b => (b.textContent ?? '').trim());
    expect(headButtons.some(t => /table|text/i.test(t))).toBe(false);
    // The field table is always the main view, outside the panel.
    const table = container.querySelector<HTMLElement>('.voice-result .vct-wrapper');
    expect(table).not.toBeNull();
    expect(table?.closest('.ui-info-disclosure__panel')).toBeNull();
    // Exactly one transcript, and it is in the panel after the field reference.
    const panel = helpPanel(container);
    const textareas = container.querySelectorAll('.voice-result textarea.description-textarea');
    expect(textareas.length).toBe(1);
    const textarea = panel.querySelector<HTMLTextAreaElement>('textarea.description-textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.getAttribute('rows')).toBe('6');
    expect(textarea?.placeholder).toBe('Start Recording and speak. The field names you say become the fields below.');
    const fields = panel.querySelector('.voice-help-fields');
    expect(fields && textarea && (fields.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    const block = panel.querySelector<HTMLElement>('.voice-transcript-block');
    expect(block?.textContent).toContain('Transcript');
    expect(block?.textContent).toContain('What was heard, in order. You can edit it here; a field name followed by its value updates the table.');
  });

  it('typing in the transcript still runs the field parser', async () => {
    const { container } = mount(<ProductDescriptionGenerator onProcessed={() => {}} />);
    await flush();
    click(infoButton(container));
    const textarea = helpPanel(container).querySelector<HTMLTextAreaElement>('textarea.description-textarea');
    if (!textarea) throw new Error('transcript not found');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(textarea, 'brand Nike period');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    const brand = container.querySelector<HTMLInputElement>('.vct-wrapper input#vct-brand');
    expect(brand?.value).toBe('Nike');
  });
});
