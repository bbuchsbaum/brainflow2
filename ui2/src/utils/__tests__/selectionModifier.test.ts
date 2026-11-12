import { afterEach, describe, expect, it } from 'vitest';
import { additiveKeyLabel, isAdditive, isMacPlatform } from '../selectionModifier';

const setPlatform = (value: string) =>
  Object.defineProperty(window.navigator, 'platform', { value, configurable: true });
const keys = (over: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }>) => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...over,
});

describe('isAdditive: one additive-selection rule per platform', () => {
  afterEach(() => {
    delete (window.navigator as { platform?: string }).platform;
  });

  it('on a Mac, Shift or ⌘ adds; Ctrl (the context-menu press) does not', () => {
    setPlatform('MacIntel');
    expect(isMacPlatform()).toBe(true);
    expect(isAdditive(keys({ shiftKey: true }))).toBe(true);
    expect(isAdditive(keys({ metaKey: true }))).toBe(true);
    expect(isAdditive(keys({ ctrlKey: true }))).toBe(false);
    expect(isAdditive(keys({}))).toBe(false);
    expect(additiveKeyLabel()).toBe('⌘');
  });

  it('elsewhere, Shift or Ctrl adds; the meta (Windows) key does not', () => {
    setPlatform('Linux x86_64');
    expect(isMacPlatform()).toBe(false);
    expect(isAdditive(keys({ shiftKey: true }))).toBe(true);
    expect(isAdditive(keys({ ctrlKey: true }))).toBe(true);
    expect(isAdditive(keys({ metaKey: true }))).toBe(false);
    expect(additiveKeyLabel()).toBe('Ctrl');
  });
});
