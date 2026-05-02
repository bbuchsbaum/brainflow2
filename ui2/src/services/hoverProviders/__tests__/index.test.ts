import { beforeEach, describe, expect, it } from 'vitest';
import { hoverInfoService } from '@/services/HoverInfoService';
import { registerBuiltinHoverProviders } from '../index';

describe('registerBuiltinHoverProviders', () => {
  beforeEach(() => {
    hoverInfoService.clear();
  });

  it('registers the built-in provider set including new hover features', () => {
    registerBuiltinHoverProviders();

    expect(hoverInfoService.getRegisteredProviderIds().sort()).toEqual([
      'atlas',
      'coords',
      'intensity',
      'neurosynth',
      'sparkline',
    ]);
  });
});
