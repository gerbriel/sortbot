import { describe, it, expect, beforeEach } from 'vitest';
import { saveStatus } from './saveStatusStore';

/** The one indicator every save path reports into: ref-counted, errors sticky until the next success. */
describe('saveStatusStore', () => {
  beforeEach(() => saveStatus.reset());

  it('goes saving → saved when the last of N writers finishes', () => {
    saveStatus.begin(); saveStatus.begin();
    expect(saveStatus.getState()).toMatchObject({ status: 'saving', pending: 2 });
    saveStatus.end(true);
    expect(saveStatus.getState()).toMatchObject({ status: 'saving', pending: 1 });
    saveStatus.end(true);
    expect(saveStatus.getState().status).toBe('saved');
    expect(saveStatus.getState().lastSavedAt).toBeTypeOf('number');
  });

  it('an error is shown until the next successful save', () => {
    saveStatus.begin(); saveStatus.end(false, 'RLS blocked');
    expect(saveStatus.getState()).toMatchObject({ status: 'error', message: 'RLS blocked', pending: 0 });
    saveStatus.begin(); saveStatus.end(true);
    expect(saveStatus.getState()).toMatchObject({ status: 'saved', message: null });
  });

  it('notifies subscribers and never goes below zero pending', () => {
    let calls = 0; const unsub = saveStatus.subscribe(() => { calls++; });
    saveStatus.end(true);
    expect(saveStatus.getState().pending).toBe(0);
    expect(calls).toBe(1);
    unsub();
  });
});
