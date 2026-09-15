import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import {
  ALL_STEPS, STEP_LABELS, nextReachable, prevReachable, type WorkflowStep,
} from '../lib/phoneSteps';
import './PhoneStepper.css';

/* ════════════════════════════════════════════════════════════════════════════
   ONE STEP AT A TIME ON A PHONE.

   Steps 1-4 are four sections of one page. On a desktop they stack and the user
   scrolls; at 390px that is a 56vh photo grid sandwiched between an upload zone
   and a description editor, with two sticky docks fighting for the bottom of the
   screen. Below 640px App hides the inactive sections with CSS
   (`.app-main[data-phone-step]`, App.css) and these two controls move between
   them. Nothing unmounts — an upload in flight, the grouper's selection and
   Step 3's debounced saves all keep running exactly as they do when a tool view
   is open (AGENTS.md §6).

   BOTH CONTROLS GO BOTH WAYS. The stepper jumps to any step that is actually on
   the page, forward or back; the bottom row carries Back beside Continue. The
   only thing that is refused is a step with no section to show — Step 3 before
   anything is categorized has nothing to render, so its chip is `disabled`
   rather than landing the user on a blank page.

   NEITHER IS STICKY. The app's own black header is `position: sticky; z-index:
   100` and owns a height this file does not know, so a second sticky bar slides
   underneath it and reads as having vanished (AGENTS.md §14 #29). The stepper
   scrolls with the page, and every step navigation scrolls back to the top, so
   it is where you left it.

   (Write token names out in full in these comments. A glob such as --ink-
   followed by a slash and another glob puts a comment terminator in the middle
   of the sentence, which ends the comment early and silently eats the first
   rule below it.)
   ════════════════════════════════════════════════════════════════════════════ */

export interface PhoneStepperProps {
  /** The step showing. Always a reachable one — App derives it through clampStep. */
  step: WorkflowStep;
  /** The steps that have a section on the page right now, in order. */
  reachable: WorkflowStep[];
  onSelect: (step: WorkflowStep) => void;
}

export default function PhoneStepper({ step, reachable, onSelect }: PhoneStepperProps) {
  const furthest = reachable.length ? reachable[reachable.length - 1] : 1;

  return (
    <nav className="phone-stepper" aria-label="Workflow steps">
      <ol className="phone-stepper-list">
        {ALL_STEPS.map(n => {
          const open = reachable.includes(n);
          const active = n === step;
          // A tick, not a number, for work already behind the user. The step
          // being looked at keeps its number even when it is behind the
          // furthest one — going back must not look like going forward.
          const done = open && !active && n < furthest;
          return (
            <li className="phone-stepper-item" key={n}>
              <button
                type="button"
                className={`phone-stepper-btn${active ? ' phone-stepper-btn--on' : ''}${done ? ' phone-stepper-btn--done' : ''}`}
                aria-current={active ? 'step' : undefined}
                disabled={!open}
                aria-disabled={open ? undefined : true}
                title={STEP_LABELS[n].long}
                onClick={() => onSelect(n)}
              >
                <span className="phone-stepper-disc" aria-hidden="true">
                  {done ? <Check size={14} strokeWidth={3} /> : n}
                </span>
                <span className="phone-stepper-label">{STEP_LABELS[n].short}</span>
                {/* The visible label is the start of the accessible name, so
                    "click Group" still works; the rest is the position and,
                    when it applies, why the chip is dead. */}
                <span className="phone-stepper-sr">
                  {` — step ${n} of ${ALL_STEPS.length}${open ? '' : ', not available yet'}`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** What unlocks the next step, said in the words of the step you are on. */
const CONTINUE_HINTS: Record<WorkflowStep, string> = {
  1: 'Upload photos to continue.',
  2: 'Assign a category to at least one group to continue.',
  3: 'Nothing to export yet.',
  4: '',
};

/**
 * The bottom row of a step section: Back at the left, Continue filling the rest.
 * Rendered by every step; each one drops the half it does not have (Step 1 has
 * no Back, Step 4 has no Continue). Phone-only — `display: none` above 640px.
 */
export function PhoneStepNav({ step, reachable, onSelect }: PhoneStepperProps) {
  const back = prevReachable(step, reachable);
  const next = nextReachable(step, reachable);
  const hint = next ? '' : CONTINUE_HINTS[step];

  if (!back && !next && !hint) return null;

  return (
    <div className="phone-step-continue">
      {back !== undefined && (
        <button type="button" className="psc-btn psc-back" onClick={() => onSelect(back)}>
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
      )}
      {next !== undefined ? (
        <button type="button" className="psc-btn psc-next" onClick={() => onSelect(next)}>
          Continue to {STEP_LABELS[next].short} <ArrowRight size={14} aria-hidden="true" />
        </button>
      ) : hint ? (
        <p className="psc-hint">{hint}</p>
      ) : null}
    </div>
  );
}
