import { useEffect, useState } from 'react';
import { Type } from 'lucide-react';
import {
  Button, ConfirmAction, EmptyState, FieldCell, FieldGrid, FieldGroup, Toast, ToastViewport,
} from './ui';
import Wordmark from './Wordmark';
import { useBrand, BRAND_NAME_MAX, BRAND_TEXT_MAX } from '../lib/brandStore';
import { probeBrand, saveBrand, validateBrandDraft, type BrandDraft } from '../lib/brandService';

/* ════════════════════════════════════════════════════════════════════════════
   BRAND: the product name, descriptor and tagline as the running app renders
   them (070_runtime_brand.sql, lib/brandStore). On the Founder console's
   Overview tab.

   Save is a ConfirmAction because it changes every screen, the landing page
   and every description generated from then on ("Powered by {name}").
   The draft follows the live brand until the founder types, so a remote
   hydrate that lands after the page opened is not shown as stale.
   ════════════════════════════════════════════════════════════════════════════ */

type Availability = 'unknown' | 'ok' | 'unavailable' | 'error';

export default function FounderBrandCard() {
  const brand = useBrand();
  const [edited, setEdited] = useState<BrandDraft | null>(null);
  const [availability, setAvailability] = useState<Availability>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void probeBrand().then(r => { if (live) setAvailability(r); });
    return () => { live = false; };
  }, []);

  const draft: BrandDraft = edited ?? { name: brand.name, descriptor: brand.descriptor, tagline: brand.tagline };
  const invalid = validateBrandDraft(draft);
  const unchanged = draft.name.trim() === brand.name
    && draft.descriptor.trim() === brand.descriptor
    && draft.tagline.trim() === brand.tagline;

  const edit = (field: keyof BrandDraft, value: string) => {
    setError(null);
    setEdited({ ...draft, [field]: value });
  };

  const handleSave = async () => {
    if (busy || invalid || unchanged) return;
    setBusy(true);
    setError(null);
    const res = await saveBrand(draft);
    setBusy(false);
    if (res.status === 'ok') {
      setEdited(null);
      setToast(`Saved. The app now says ${res.brand.name}.`);
    } else if (res.status === 'unavailable') {
      setAvailability('unavailable');
    } else if (res.status === 'forbidden') {
      setError('Founding Workspace admins only.');
    } else {
      setError(res.message);
    }
  };

  const counter = (value: string, max: number) => {
    const n = value.trim().length;
    return (
      <span className={`fc-brand-count${n > max ? ' fc-brand-count--over' : ''}`} aria-live="polite">
        {n} / {max}
      </span>
    );
  };

  return (
    <section className="fc-brand" aria-labelledby="fc-brand-title">
      <h3 id="fc-brand-title" className="org-section-title">
        <Type size={13} /> Brand
      </h3>

      {availability === 'unavailable' ? (
        <EmptyState
          inline
          icon={<Type size={22} />}
          title="Brand editing needs one migration"
          description={<>Run <code>070_runtime_brand.sql</code> in the Supabase SQL Editor. Until then the app shows the name from brand.json.</>}
        />
      ) : (
        <>
          <FieldGroup caption="Product name">
            <FieldGrid columns={3}>
              <FieldCell label="Name" meta={counter(draft.name, BRAND_NAME_MAX)}>
                {(c) => (
                  <input {...c} type="text" value={draft.name} maxLength={BRAND_NAME_MAX + 8}
                    onChange={e => edit('name', e.target.value)} autoComplete="off" />
                )}
              </FieldCell>
              <FieldCell label="Descriptor" meta={counter(draft.descriptor, BRAND_TEXT_MAX)}>
                {(c) => (
                  <input {...c} type="text" value={draft.descriptor}
                    onChange={e => edit('descriptor', e.target.value)} autoComplete="off" />
                )}
              </FieldCell>
              <FieldCell label="Tagline" meta={counter(draft.tagline, BRAND_TEXT_MAX)}>
                {(c) => (
                  <input {...c} type="text" value={draft.tagline}
                    onChange={e => edit('tagline', e.target.value)} autoComplete="off" />
                )}
              </FieldCell>
            </FieldGrid>
          </FieldGroup>

          <p className="fc-brand-preview" aria-label="Preview">
            <Wordmark name={draft.name.trim() || ' '} />
            {draft.descriptor.trim() && <span className="fc-brand-preview-descriptor">{draft.descriptor.trim()}</span>}
          </p>

          <div className="fc-brand-actions">
            <ConfirmAction
              label={busy ? 'Saving' : 'Save brand'}
              confirmLabel="Save"
              prompt="Change the name on every screen?"
              tone="neutral"
              size="md"
              disabled={busy || !!invalid || unchanged}
              onConfirm={() => { void handleSave(); }}
            />
            {edited && !unchanged && !busy && (
              <Button size="md" variant="ghost" onClick={() => { setEdited(null); setError(null); }}>
                Discard
              </Button>
            )}
          </div>
          {(invalid && !unchanged) && <p className="fc-brand-error" role="alert">{invalid}</p>}
          {error && <p className="fc-brand-error" role="alert">{error}</p>}
        </>
      )}

      <p className="shopify-conn-help">
        This changes the name across the app and the landing page immediately. The browser tab
        title, the install icons and the iOS and Android app names follow the next deploy
        (brand.json, npm run brand:apply, brand:assets).
      </p>

      {toast && (
        <ToastViewport>
          <Toast tone="success" message={toast} onDismiss={() => setToast(null)} />
        </ToastViewport>
      )}
    </section>
  );
}
