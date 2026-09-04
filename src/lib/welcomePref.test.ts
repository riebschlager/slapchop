import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWelcomeDismissed, setWelcomeDismissed } from './welcomePref';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

const KEY = 'slapchop.welcomeDismissed';

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe('getWelcomeDismissed', () => {
  it('returns false when key is absent', () => {
    expect(getWelcomeDismissed()).toBe(false);
  });

  it('returns true when key is "1"', () => {
    localStorageMock.getItem.mockReturnValueOnce('1');
    expect(getWelcomeDismissed()).toBe(true);
  });

  it('returns false when key has any other value', () => {
    localStorageMock.getItem.mockReturnValueOnce('true');
    expect(getWelcomeDismissed()).toBe(false);
  });
});

describe('setWelcomeDismissed', () => {
  it('sets key to "1" when value is true', () => {
    setWelcomeDismissed(true);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(KEY, '1');
  });

  it('removes key when value is false', () => {
    setWelcomeDismissed(false);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(KEY);
  });
});
