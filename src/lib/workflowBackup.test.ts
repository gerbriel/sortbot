import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WORKFLOW_BACKUP_KEY,
  BACKUP_THROTTLE_MS,
  scheduleWorkflowBackup,
  flushWorkflowBackup,
  cancelWorkflowBackup,
  __resetWorkflowBackupForTests,
  __workflowBackupStatsForTests,
} from './workflowBackup';

const payload = (batchId: string, items: unknown[] = [{ id: 'a' }]) => () => ({
  batchId,
  savedAt: 1,
  items,
});

const stored = () => {
  const raw = localStorage.getItem(WORKFLOW_BACKUP_KEY);
  return raw ? JSON.parse(raw) : null;
};

describe('workflowBackup — trailing throttle (F7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    __resetWorkflowBackupForTests();
  });

  afterEach(() => {
    __resetWorkflowBackupForTests();
    vi.useRealTimers();
  });

  it('does not write synchronously — the write is deferred by the throttle window', () => {
    scheduleWorkflowBackup(payload('batch-1'));
    expect(stored()).toBeNull();
    expect(__workflowBackupStatsForTests()).toEqual({ writes: 0, pending: true });

    vi.advanceTimersByTime(BACKUP_THROTTLE_MS);
    expect(stored()?.batchId).toBe('batch-1');
    expect(__workflowBackupStatsForTests().writes).toBe(1);
  });

  it('collapses a burst of 50 calls into ONE setItem', () => {
    for (let i = 0; i < 50; i++) scheduleWorkflowBackup(payload(`batch-${i}`));
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS);
    expect(__workflowBackupStatsForTests().writes).toBe(1);
  });

  it('writes the LAST payload scheduled inside the window, not the first', () => {
    scheduleWorkflowBackup(payload('first'));
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS / 2);
    scheduleWorkflowBackup(payload('last'));
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS);
    expect(stored()?.batchId).toBe('last');
    expect(__workflowBackupStatsForTests().writes).toBe(1);
  });

  it('is a THROTTLE, not a debounce — a steady stream keeps writing', () => {
    // A debounce would never fire at all here: every call would push the deadline out
    // and the user would be one refresh away from losing everything. The throttle
    // closes its window regardless. 6 calls 750 ms apart spans 4 500 ms; windows open
    // at 0, 1 500 and 3 000 and close at 1 000, 2 500 and 4 000 => exactly 3 writes.
    for (let i = 0; i < 6; i++) {
      scheduleWorkflowBackup(payload(`tick-${i}`));
      vi.advanceTimersByTime(BACKUP_THROTTLE_MS * 0.75);
    }
    expect(__workflowBackupStatsForTests().writes).toBe(3);
    expect(stored()?.batchId).toBe('tick-5');   // the newest snapshot in the last closed window
  });

  it('opens a fresh window after one closes', () => {
    scheduleWorkflowBackup(payload('a'));
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS);
    scheduleWorkflowBackup(payload('b'));
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS);
    expect(stored()?.batchId).toBe('b');
    expect(__workflowBackupStatsForTests().writes).toBe(2);
  });

  it('a builder returning null writes nothing (no items / no batch id yet)', () => {
    scheduleWorkflowBackup(() => null);
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS);
    expect(stored()).toBeNull();
    expect(__workflowBackupStatsForTests().writes).toBe(0);
  });
});

describe('workflowBackup — flush keeps the refresh guarantee', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    __resetWorkflowBackupForTests();
  });

  afterEach(() => {
    __resetWorkflowBackupForTests();
    vi.useRealTimers();
  });

  it('flush writes the pending payload immediately, without waiting for the window', () => {
    scheduleWorkflowBackup(payload('unsaved'));
    expect(stored()).toBeNull();
    flushWorkflowBackup();   // what pagehide / beforeunload calls
    expect(stored()?.batchId).toBe('unsaved');
  });

  it('flush with nothing pending is a no-op and does not clobber the stored backup', () => {
    scheduleWorkflowBackup(payload('kept'));
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS);
    flushWorkflowBackup();
    expect(stored()?.batchId).toBe('kept');
    expect(__workflowBackupStatsForTests().writes).toBe(1);
  });

  it('flush consumes the pending write, so the timer cannot write it a second time', () => {
    scheduleWorkflowBackup(payload('once'));
    flushWorkflowBackup();
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS * 3);
    expect(__workflowBackupStatsForTests().writes).toBe(1);
  });
});

describe('workflowBackup — cancel (active batch deleted)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    __resetWorkflowBackupForTests();
  });

  afterEach(() => {
    __resetWorkflowBackupForTests();
    vi.useRealTimers();
  });

  it('a cancelled write never lands, so removeItem cannot be undone by a late timer', () => {
    scheduleWorkflowBackup(payload('doomed'));
    cancelWorkflowBackup();
    localStorage.removeItem(WORKFLOW_BACKUP_KEY);
    vi.advanceTimersByTime(BACKUP_THROTTLE_MS * 3);
    expect(stored()).toBeNull();
    expect(__workflowBackupStatsForTests().writes).toBe(0);
  });
});

describe('workflowBackup — quota errors are reported, not swallowed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    __resetWorkflowBackupForTests();
  });

  afterEach(() => {
    __resetWorkflowBackupForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs a warning when setItem throws and keeps the app running', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    scheduleWorkflowBackup(payload('too-big'));
    expect(() => vi.advanceTimersByTime(BACKUP_THROTTLE_MS)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('[workflowBackup]');
    expect(__workflowBackupStatsForTests().writes).toBe(0);

    setItem.mockRestore();
  });

  it('a throwing payload builder is contained and logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scheduleWorkflowBackup(() => { throw new Error('snapshot gone'); });
    expect(() => vi.advanceTimersByTime(BACKUP_THROTTLE_MS)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(stored()).toBeNull();
  });
});
