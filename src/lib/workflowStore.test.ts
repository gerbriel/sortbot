import { describe, it, expect, beforeEach } from 'vitest';
import { workflowStore, liveArrayRef } from './workflowStore';
import type { ClothingItem } from '../App';

const item = (id: string): ClothingItem => ({ id } as unknown as ClothingItem);

beforeEach(() => {
  workflowStore.reset();
});

describe('workflowStore (dependency-free shared store)', () => {
  it('starts empty', () => {
    const s = workflowStore.getState();
    expect(s.processedItems).toEqual([]);
    expect(s.currentBatchId).toBeNull();
  });

  it('setState merges partial updates', () => {
    workflowStore.setState({ currentBatchId: 'batch-1' });
    workflowStore.setState({ processedItems: [item('a')] });
    const s = workflowStore.getState();
    expect(s.currentBatchId).toBe('batch-1');       // untouched by second update
    expect(s.processedItems).toHaveLength(1);
  });

  it('supports functional updates reading the previous state', () => {
    workflowStore.setState({ processedItems: [item('a')] });
    workflowStore.setState(prev => ({ processedItems: [...prev.processedItems, item('b')] }));
    expect(workflowStore.getState().processedItems.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('getState always returns the LIVE state inside async callbacks (no ref mirrors)', async () => {
    workflowStore.setState({ currentBatchId: 'stale' });
    const readLater = new Promise<string | null>(resolve => {
      setTimeout(() => resolve(workflowStore.getState().currentBatchId), 0);
    });
    workflowStore.setState({ currentBatchId: 'fresh' }); // changes BEFORE the timeout fires
    expect(await readLater).toBe('fresh');
  });

  it('notifies subscribers on every update and stops after unsubscribe', () => {
    let calls = 0;
    const unsub = workflowStore.subscribe(() => { calls++; });
    workflowStore.setState({ currentBatchId: 'x' });
    workflowStore.setState({ currentBatchId: 'y' });
    expect(calls).toBe(2);
    unsub();
    workflowStore.setState({ currentBatchId: 'z' });
    expect(calls).toBe(2);
  });

  it('liveArrayRef.current always reads the CURRENT store state (ref-mirror replacement)', () => {
    const ref = liveArrayRef('processedItems');
    expect(ref.current).toEqual([]);
    workflowStore.setState({ processedItems: [item('a')] });
    expect(ref.current.map(i => i.id)).toEqual(['a']);       // fresh immediately — no render needed
    workflowStore.setState(prev => ({ processedItems: [...prev.processedItems, item('b')] }));
    expect(ref.current.map(i => i.id)).toEqual(['a', 'b']);
    // Same ref object keeps working across resets (stable identity, safe to close over)
    workflowStore.reset();
    expect(ref.current).toEqual([]);
  });

  it('liveArrayRef sees updates from inside an async callback (the stale-closure killer)', async () => {
    const ref = liveArrayRef('uploadedImages');
    const readLater = new Promise<number>(resolve => {
      setTimeout(() => resolve(ref.current.length), 0);
    });
    workflowStore.setState({ uploadedImages: [item('x'), item('y')] });
    expect(await readLater).toBe(2);
  });

  it('reset clears everything (sign-out / active-batch deletion)', () => {
    workflowStore.setState({ currentBatchId: 'x', processedItems: [item('a')] });
    workflowStore.reset();
    const s = workflowStore.getState();
    expect(s.currentBatchId).toBeNull();
    expect(s.processedItems).toEqual([]);
  });
});
