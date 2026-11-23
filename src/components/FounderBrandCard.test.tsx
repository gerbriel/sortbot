import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { mount, cleanup, click, all, one, buttonByText } from './ui/testUtils';

const rpc = vi.fn();
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import FounderBrandCard from './FounderBrandCard';
import { brandStore, getBrand, BUILD_BRAND } from '../lib/brandStore';

/**
 * The Founder console's Brand card (070_runtime_brand.sql). Only the Supabase
 * client is mocked, so brandService's real request shape and brandStore's real
 * apply both run: what matters is which RPC Save calls, with what, and that
 * the answer renames the app at once.
 */

const answer = (name: string) => ({
  data: { name, descriptor: 'Listings in a hurry', tagline: `${name} lists your rack.`, updated_at: '2026-11-22T00:00:00Z' },
  error: null,
});

function type(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function flush() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

const inputs = (c: HTMLElement) => all(c, 'input') as HTMLInputElement[];

beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
  brandStore.reset();
});

afterEach(() => {
  cleanup();
  brandStore.reset();
});

describe('FounderBrandCard', () => {
  it('shows the live brand, counts and a preview of the draft', async () => {
    rpc.mockResolvedValue(answer(BUILD_BRAND.name));
    const { container } = mount(<FounderBrandCard />);
    await flush();
    const [name, descriptor, tagline] = inputs(container);
    expect(name.value).toBe(BUILD_BRAND.name);
    expect(descriptor.value).toBe('Listings in a hurry');
    expect(tagline.value).toContain('lists your rack');
    type(name, 'Acorn');
    expect(one(container, '.fc-brand-preview .wordmark').textContent).toBe('Acorn');
    expect(container.textContent).toContain('5 / 24');
    expect(container.textContent).toContain('immediately. The browser tab');
  });

  it('Save confirms, then calls founding_set_brand and renames the app', async () => {
    rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'founding_set_brand' ? answer('Acorn') : answer(BUILD_BRAND.name)));
    const { container } = mount(<FounderBrandCard />);
    await flush();
    const [name] = inputs(container);
    type(name, '  Acorn ');
    click(buttonByText(container, 'Save brand'));
    // ConfirmAction: nothing is sent until the second step.
    expect(rpc).not.toHaveBeenCalledWith('founding_set_brand', expect.anything());
    click(buttonByText(container, 'Save'));
    await flush();
    expect(rpc).toHaveBeenCalledWith('founding_set_brand', {
      p_name: 'Acorn',
      p_descriptor: 'Listings in a hurry',
      p_tagline: `${BUILD_BRAND.name} lists your rack.`,
    });
    expect(getBrand()).toMatchObject({ name: 'Acorn', source: 'remote' });
    expect(container.textContent).toContain('Saved. The app now says Acorn.');
  });

  it('cannot save an empty or over-long name', async () => {
    rpc.mockResolvedValue(answer(BUILD_BRAND.name));
    const { container } = mount(<FounderBrandCard />);
    await flush();
    const [name] = inputs(container);
    type(name, '');
    expect((buttonByText(container, 'Save brand') as HTMLButtonElement).disabled).toBe(true);
    type(name, 'x'.repeat(25));
    expect((buttonByText(container, 'Save brand') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('at most 24 characters');
  });

  it('shows the 070 setup line when the function is missing', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const { container } = mount(<FounderBrandCard />);
    await flush();
    expect(container.textContent).toContain('070_runtime_brand.sql');
    expect(inputs(container)).toHaveLength(0);
    expect(getBrand().source).toBe('build');
  });

  it('turns into the setup line when Save finds the function missing', async () => {
    rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'founding_set_brand'
      ? { data: null, error: { code: '42883', message: 'function does not exist' } }
      : answer(BUILD_BRAND.name)));
    const { container } = mount(<FounderBrandCard />);
    await flush();
    type(inputs(container)[0], 'Acorn');
    click(buttonByText(container, 'Save brand'));
    click(buttonByText(container, 'Save'));
    await flush();
    expect(container.textContent).toContain('Run 070_runtime_brand.sql');
    expect(getBrand().name).toBe(BUILD_BRAND.name);
  });

  it('reports a server refusal in words and keeps the draft', async () => {
    rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'founding_set_brand'
      ? { data: null, error: { code: '42501', message: 'Not authorized' } }
      : answer(BUILD_BRAND.name)));
    const { container } = mount(<FounderBrandCard />);
    await flush();
    type(inputs(container)[0], 'Acorn');
    click(buttonByText(container, 'Save brand'));
    click(buttonByText(container, 'Save'));
    await flush();
    expect(container.textContent).toContain('Founding Workspace admins only.');
    expect(inputs(container)[0].value).toBe('Acorn');
  });
});
