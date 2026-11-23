import { useId, useMemo, useState } from 'react';
import {
  LISTINGS_PER_WEEK, MINUTES_TODAY, MINUTES_WITH_SQRL,
  clampTo, computeTime, formatCount, formatHours, type Range,
} from './timeMath';
import './TimeCalculator.css';

/* ── TimeCalculator: "What the typing costs you." ───────────────────────────
   Lazy-loaded by Landing.tsx. Every output comes from timeMath.computeTime
   on the visitor's own three numbers. There are no revenue or dollar figures
   and no benchmark from other shops, by design. */

/**
 * A number field that lets the visitor type freely (an empty box, a partial
 * "1") and only snaps to the range on blur. A value typed inside the range is
 * applied immediately, so the slider and the outputs follow the keyboard.
 */
function useBoundNumber(range: Range) {
  const [value, setValue] = useState(range.def);
  const [draft, setDraft] = useState(String(range.def));

  const fromSlider = (raw: string) => {
    const n = clampTo(Number(raw), range);
    setValue(n);
    setDraft(String(n));
  };
  const fromField = (raw: string) => {
    setDraft(raw);
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n) && n >= range.min && n <= range.max) setValue(n);
  };
  const commit = () => {
    const n = draft.trim() === '' ? value : clampTo(Number(draft), range);
    setValue(n);
    setDraft(String(n));
  };
  return { value, draft, fromSlider, fromField, commit };
}

interface SliderRowProps {
  label: string;
  unit: string;
  range: Range;
  bound: ReturnType<typeof useBoundNumber>;
}

function SliderRow({ label, unit, range, bound }: SliderRowProps) {
  const id = useId();
  return (
    <div className="ltc-input">
      <div className="ltc-input-head">
        <label htmlFor={`${id}-n`}>{label}</label>
        <span className="ltc-input-field">
          <input
            id={`${id}-n`}
            type="number"
            inputMode="numeric"
            min={range.min}
            max={range.max}
            step={1}
            value={bound.draft}
            onChange={(e) => bound.fromField(e.target.value)}
            onBlur={bound.commit}
          />
          <span className="ltc-unit" aria-hidden="true">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        className="ltc-range"
        aria-label={label}
        min={range.min}
        max={range.max}
        step={1}
        value={bound.value}
        onChange={(e) => bound.fromSlider(e.target.value)}
      />
      <div className="ltc-range-ends" aria-hidden="true">
        <span>{range.min}</span>
        <span>{range.max}</span>
      </div>
    </div>
  );
}

export default function TimeCalculator() {
  const listings = useBoundNumber(LISTINGS_PER_WEEK);
  const today = useBoundNumber(MINUTES_TODAY);
  const sqrl = useBoundNumber(MINUTES_WITH_SQRL);
  const sqrlId = useId();

  const out = useMemo(
    () => computeTime({ listingsPerWeek: listings.value, minutesToday: today.value, minutesWithSqrl: sqrl.value }),
    [listings.value, today.value, sqrl.value],
  );

  return (
    <div className="ltc">
      <div className="ltc-grid">
        <div className="ltc-inputs">
          <SliderRow label="Listings per week" unit="a week" range={LISTINGS_PER_WEEK} bound={listings} />
          <SliderRow label="Minutes you spend writing one listing today" unit="min" range={MINUTES_TODAY} bound={today} />

          <div className="ltc-assume">
            <div className="ltc-input-head">
              <label htmlFor={sqrlId}>Minutes per listing with SQRL</label>
              <span className="ltc-input-field">
                <input
                  id={sqrlId}
                  type="number"
                  inputMode="numeric"
                  min={MINUTES_WITH_SQRL.min}
                  max={MINUTES_WITH_SQRL.max}
                  step={1}
                  value={sqrl.draft}
                  onChange={(e) => sqrl.fromField(e.target.value)}
                  onBlur={sqrl.commit}
                  aria-describedby={`${sqrlId}-hint`}
                />
                <span className="ltc-unit" aria-hidden="true">min</span>
              </span>
            </div>
            <p id={`${sqrlId}-hint`} className="ltc-hint">
              Your estimate; dictating a listing takes most people a few minutes.
            </p>
          </div>
        </div>

        <dl className="ltc-outputs" aria-live="polite">
          <div className="ltc-out">
            <dt>Hours a month writing listings today</dt>
            <dd data-testid="ltc-today">{formatHours(out.hoursTodayPerMonth)}</dd>
          </div>
          <div className="ltc-out">
            <dt>Hours a month with SQRL</dt>
            <dd data-testid="ltc-sqrl">{formatHours(out.hoursWithSqrlPerMonth)}</dd>
          </div>
          <div className="ltc-out ltc-out--lead">
            <dt>Hours reclaimed a month</dt>
            <dd data-testid="ltc-reclaimed">{formatHours(out.hoursReclaimedPerMonth)}</dd>
          </div>
          <div className="ltc-out">
            <dt>Listings you could add in that time at your SQRL pace</dt>
            <dd data-testid="ltc-extra">{formatCount(out.extraListingsPerMonth)}</dd>
          </div>
        </dl>
      </div>

      <p className="ltc-foot">Estimates from your own numbers. Nothing here is measured from other shops.</p>
    </div>
  );
}
