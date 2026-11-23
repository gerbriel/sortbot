import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RotateCcw, Shirt } from 'lucide-react';
import { Badge, Button, FieldCell, FieldGrid, FieldGroup, Skeleton, SkeletonText, ToggleChip } from '../ui';
import { DEMO_SAMPLES, STEP_DELAY_MS, runDemo, type DemoResult, type DemoSample } from './demoPipeline';
import './LandingDemo.css';

/* ── LandingDemo: "See a listing come together." ────────────────────────────
   Lazy-loaded by Landing.tsx, because demoPipeline pulls in the whole text
   engine. Every value on screen is computed by the real modules from the
   sample inputs in demoPipeline.ts: nothing here is pre-written output.

   The four steps reveal one after another, STEP_DELAY_MS apart, so the
   sequence reads as cause and effect. Under prefers-reduced-motion they all
   appear at once and nothing animates. */

const STEP_COUNT = 4;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function LandingDemo() {
  const [sample, setSample] = useState<DemoSample>(DEMO_SAMPLES[0]);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [shown, setShown] = useState(0);
  const [failed, setFailed] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  useEffect(() => {
    let live = true;
    clearTimers();
    setShown(0);
    setFailed(false);
    runDemo(sample).then(
      (r) => {
        if (!live) return;
        setResult(r);
        if (prefersReducedMotion()) {
          setShown(STEP_COUNT);
          return;
        }
        setShown(1);
        for (let i = 2; i <= STEP_COUNT; i++) {
          timers.current.push(window.setTimeout(() => setShown(i), STEP_DELAY_MS * (i - 1)));
        }
      },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; clearTimers(); };
  }, [sample, runKey, clearTimers]);

  const ready = result !== null && shown > 0;
  const busy = !failed && shown < STEP_COUNT;

  return (
    <div className="ldd">
      <div className="ldd-controls">
        <div className="ldd-chips" role="group" aria-label="Sample item">
          {DEMO_SAMPLES.map((s) => (
            <ToggleChip
              key={s.id}
              className="ldd-chip"
              pressed={s.id === sample.id}
              onPressedChange={() => { if (s.id !== sample.id) setSample(s); }}
            >
              {s.name}
            </ToggleChip>
          ))}
        </div>
        <Button
          variant="ghost"
          className="ldd-replay"
          icon={<RotateCcw size={16} aria-hidden />}
          onClick={() => setRunKey((k) => k + 1)}
          disabled={busy}
        >
          Replay
        </Button>
      </div>

      <p className="ui-sr-only" role="status">
        {failed ? 'The sample could not be generated.' : shown >= STEP_COUNT ? `Listing ready for ${sample.name}.` : ''}
      </p>

      <div className="ldd-body">
        <div className="ldd-tile" aria-hidden="true">
          <Shirt size={28} strokeWidth={1.5} />
          <span>{sample.name}</span>
          <small>Sample item, no photo</small>
        </div>

        {failed ? (
          <p className="ldd-error">The sample could not be generated. Try Replay.</p>
        ) : (
          <ol className="ldd-steps">
            <Step n={1} label="You say" visible={ready && shown >= 1}>
              {result && (
                <p className="ldd-transcript" data-testid="ldd-transcript">
                  {result.transcript.map((part, i) =>
                    part.field
                      ? <mark key={i} className="ldd-kw" title="Field name">{part.text}</mark>
                      : <span key={i}>{part.text}</span>,
                  )}
                </p>
              )}
            </Step>

            <Step n={2} label="The grammar fills the fields" visible={ready && shown >= 2}>
              {result && (
                <FieldGroup caption="Fields" className="ldd-fields">
                  <FieldGrid columns={3}>
                    {result.fields.map((f) => (
                      <FieldCell
                        key={f.key}
                        label={f.label}
                        span={f.key === 'customDescription' ? 'full' : undefined}
                        meta={f.source === 'preset' ? <Badge size="sm">Preset</Badge> : undefined}
                      >
                        {(c) => <input {...c} readOnly value={f.value} />}
                      </FieldCell>
                    ))}
                  </FieldGrid>
                </FieldGroup>
              )}
            </Step>

            <Step n={3} label="The template writes the listing" visible={ready && shown >= 3}>
              {result && (
                <div className="ldd-listing">
                  <div className="ldd-listing-title">
                    <span className="ldd-k">Title</span>
                    <strong data-testid="ldd-title">{result.title}</strong>
                    <span className="ldd-count">{result.title.length} characters</span>
                  </div>
                  <div className="ldd-desc">
                    <span className="ldd-k">Description</span>
                    <p data-testid="ldd-description">{result.description}</p>
                  </div>
                  <p className="ldd-note">Same input, same listing, every time. There is no model guessing.</p>
                </div>
              )}
            </Step>

            <Step n={4} label="The Shopify CSV row" visible={ready && shown >= 4}>
              {result && (
                <dl className="ldd-csv" data-testid="ldd-csv">
                  {result.csv.map((c) => (
                    <div key={c.column} className="ldd-csv-cell">
                      <dt>{c.column}</dt>
                      <dd>{c.value || '(empty)'}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Step>
          </ol>
        )}
      </div>
    </div>
  );
}

function Step({ n, label, visible, children }: { n: number; label: string; visible: boolean; children: ReactNode }) {
  return (
    <li className="ldd-step" data-visible={visible ? 'true' : 'false'} aria-busy={!visible}>
      <div className="ldd-step-head">
        <span className="ldd-step-n" aria-hidden="true">{n}</span>
        <h3>{label}</h3>
      </div>
      {visible ? (
        <div className="ldd-step-body">{children}</div>
      ) : (
        <div className="ldd-step-wait" aria-hidden="true">
          {n === 1 ? <Skeleton width="80%" /> : <SkeletonText lines={2} />}
        </div>
      )}
    </li>
  );
}
