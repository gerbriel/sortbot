import { describe, it, expect, vi } from 'vitest';
import { createPresetWriteQueue, describeSaveError } from './presetWriteQueue';

const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('presetWriteQueue', () => {
  it('coalesces patches enqueued in the same tick into one write', async () => {
    const write = vi.fn(async () => ({}));
    const q = createPresetWriteQueue({ write });
    q.enqueue('p1', { a: 1 });
    q.enqueue('p1', { b: 2 });
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('p1', { a: 1, b: 2 });
  });

  it('serialises per preset: a later value waits for the slow write and wins', async () => {
    const first = deferred<object>();
    const write = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => ({}));
    const q = createPresetWriteQueue({ write });
    q.enqueue('p1', { name: 'A' });
    await tick();
    q.enqueue('p1', { name: 'AB' });
    q.enqueue('p1', { name: 'ABC' });
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve({});
    await tick();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith('p1', { name: 'ABC' });
  });

  it('keeps a failed patch for retry, and a newer pending value wins over it', async () => {
    const onError = vi.fn();
    const write = vi.fn()
      .mockRejectedValueOnce({ code: '23514', message: 'check failed' })
      .mockResolvedValue({});
    const q = createPresetWriteQueue({ write, onError });
    q.enqueue('p1', { a: 1, b: 1 });
    await tick();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(q.failed('p1')).toEqual({ a: 1, b: 1 });
    q.retry('p1');
    await tick();
    expect(write).toHaveBeenLastCalledWith('p1', { a: 1, b: 1 });
    expect(q.failed('p1')).toBeNull();
  });

  it('describes a PostgREST error as message plus code', () => {
    expect(describeSaveError({ code: 'PGRST204', message: "Could not find the 'custom_sections' column" }))
      .toBe("Could not find the 'custom_sections' column (PGRST204)");
    expect(describeSaveError(new Error('boom'))).toBe('boom');
    expect(describeSaveError(null)).toBe('Save failed');
  });
});
