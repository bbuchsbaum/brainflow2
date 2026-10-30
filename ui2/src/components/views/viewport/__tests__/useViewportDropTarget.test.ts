import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useViewportDropTarget } from '../useViewportDropTarget';

describe('useViewportDropTarget', () => {
  it('hands every file of a multi-file OS drop to onNativeFileDrop, in order', async () => {
    const onNativeFileDrop = vi.fn().mockResolvedValue(undefined);
    const onPathDrop = vi.fn();
    const { result } = renderHook(() => useViewportDropTarget({ onNativeFileDrop, onPathDrop }));
    const files = [new File([], 'a.nii'), new File([], 'b.nii'), new File([], 'c.gii')];

    result.current.handleDrop({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files, getData: () => '' },
    } as unknown as React.DragEvent);

    await waitFor(() => expect(onNativeFileDrop).toHaveBeenCalledTimes(3));
    expect(onNativeFileDrop.mock.calls.map(([f]) => f.name)).toEqual(['a.nii', 'b.nii', 'c.gii']);
    expect(onPathDrop).not.toHaveBeenCalled();
  });
});
