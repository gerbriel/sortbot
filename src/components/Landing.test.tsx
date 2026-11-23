import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, cleanup } from './ui/testUtils';

vi.mock('../lib/betaService', () => ({ requestBetaAccess: vi.fn() }));
vi.mock('../lib/analytics', () => ({ track: vi.fn() }));

import Landing from './Landing';
import { BRAND, BRAND_TITLE_LANDING } from '../brand';

const LANDING_TITLE = BRAND_TITLE_LANDING;

describe('Landing document title', () => {
  afterEach(() => {
    cleanup();
    document.title = '';
  });

  it('sets a descriptive title under 60 characters on mount', () => {
    document.title = BRAND;
    mount(<Landing onLoginClick={() => {}} />);
    expect(document.title).toBe(LANDING_TITLE);
    expect(document.title.length).toBeLessThan(60);
  });

  it('restores the previous title on unmount', () => {
    document.title = BRAND;
    const view = mount(<Landing onLoginClick={() => {}} />);
    view.unmount();
    expect(document.title).toBe(BRAND);
  });
});
