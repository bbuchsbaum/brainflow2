import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LabelList } from '@/modules/segmentation/components/shared/LabelList';
import { SliceProgress } from '@/modules/segmentation/components/shared/SliceProgress';
import { info } from '@/modules/segmentation/__tests__/liveFixtures';
import { parseSegmentationLabels } from '@/modules/segmentation/labelTable';
const labels = [{ id: 1, name: 'A', long: 'A', color: 'rgb(1 2 3)', voxels: 1, mm3: 1, locked: false, visible: true, status: 'in-progress' as const }];
describe('live segmentation controls', () => {
 it('keeps eye and lock clicks from selecting their row', () => { const select=vi.fn(), eye=vi.fn(), lock=vi.fn(); render(<LabelList labels={labels} activeId={1} onSelect={select} onToggleVisibility={eye} onToggleLock={lock}/>); fireEvent.click(screen.getByLabelText('Hide A')); expect(eye).toHaveBeenCalledWith(1); expect(select).not.toHaveBeenCalled(); fireEvent.click(screen.getByLabelText('Lock A')); expect(lock).toHaveBeenCalledWith(1); expect(select).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('row')); expect(select).toHaveBeenCalledWith(1); });
 it('uses one live scale, exposes flags, and navigates native slices', () => { const pick=vi.fn(); const snapshot=info(1).snapshot; snapshot.labels[0].sliceVoxels=[5,0,5]; render(<SliceProgress snapshot={snapshot} activeId={1} current={0} onPick={pick}/>); expect(screen.getByTestId('live-slice-matrix-scale')).toHaveTextContent('max 5'); const target=screen.getByLabelText(/ROI A, slice 2/); fireEvent.click(target); expect(pick).toHaveBeenCalledWith(1); expect(target).toHaveAttribute('aria-label', expect.stringContaining('gap')); });
 it('validates imported JSON hierarchy', () => { expect(() => parseSegmentationLabels('[{"id":1,"name":"A","abbreviation":"A","color":[1,2,3],"parent":2},{"id":2,"name":"B","abbreviation":"B","color":[1,2,3],"parent":1}]')).toThrow('cycle'); expect(parseSegmentationLabels('[{"id":1,"name":"A","abbreviation":"A","color":[1,2,3],"parent":null}]')).toHaveLength(1); });
 it('accepts every u16 label id and rejects ids outside it', () => {
    const table = (id: number) => `[{"id":${id},"name":"A","abbreviation":"A","color":[1,2,3],"parent":null}]`;
    expect(parseSegmentationLabels(table(65535))[0].id).toBe(65535);
    expect(parseSegmentationLabels(table(2048))[0].id).toBe(2048);
    expect(() => parseSegmentationLabels(table(65536))).toThrow('1 to 65535');
    expect(() => parseSegmentationLabels(table(0))).toThrow('1 to 65535');
  });
});
