import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AdvancedSection } from '../AdvancedSection';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';

describe('AdvancedSection', () => {
  it('is hidden unless Settings › Experimental features is on (the code is kept)', () => {
    act(() => useFeatureFlagStore.getState().setExperimentalFeatures(false));
    const { rerender } = render(<AdvancedSection item={{ id: 'a', kind: 'volume-base' } as never} />);
    expect(screen.queryByText('Advanced')).toBeNull();
    act(() => useFeatureFlagStore.getState().setExperimentalFeatures(true));
    rerender(<AdvancedSection item={{ id: 'a', kind: 'volume-base' } as never} />);
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    act(() => useFeatureFlagStore.getState().setExperimentalFeatures(false));
  });
});
