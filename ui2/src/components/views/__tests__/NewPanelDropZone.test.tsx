import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewPanelDropZone } from '../NewPanelDropZone';
import { FILE_DRAG_MIME } from '@/utils/layerDrag';

describe('NewPanelDropZone', () => {
  it('accepts file-browser drag payloads to create a new panel from a loaded file', () => {
    const onDrop = vi.fn();
    const onFileDrop = vi.fn();

    render(<NewPanelDropZone onDrop={onDrop} onFileDrop={onFileDrop} />);

    const dataTransfer = {
      files: [],
      getData: vi.fn((type: string) =>
        type === FILE_DRAG_MIME
          ? JSON.stringify({
              path: '/tmp/subject01.nii.gz',
              name: 'subject01.nii.gz',
              type: 'file',
              extension: '.nii.gz',
            })
          : ''
      ),
      dropEffect: 'none',
    };

    fireEvent.drop(screen.getByText('+ Drop layer or file to add panel'), { dataTransfer });

    expect(onDrop).not.toHaveBeenCalled();
    expect(onFileDrop).toHaveBeenCalledWith('/tmp/subject01.nii.gz');
  });
});
