import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ImageSetSection } from '../sections/ImageSetSection';
import { useLayerStore } from '@/stores/layerStore';
import { useImageSetStore } from '@/stores/imageSetStore';
import type { SceneItem } from '@/types/sceneItem';
const m = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('@/services/ImageSetService', () => ({
  getImageSetService: () => ({ selectMember: m.select }),
}));
const item: SceneItem = {
  id: 'layer',
  name: 'Statistics',
  kind: 'volume-overlay',
  group: 'volume',
  subtitle: '',
  visible: true,
  opacity: 1,
  ref: { type: 'volume', layerId: 'layer' },
};
beforeEach(() => {
  m.select.mockReset();
  useLayerStore.setState({
    layers: [
      {
        id: 'layer',
        volumeId: 'v',
        name: 'Statistics',
        type: 'functional',
        visible: true,
        order: 0,
        imageSetId: 'set',
      },
    ],
  });
  useImageSetStore.setState({
    sets: {
      set: {
        id: 'set',
        name: 'Statistics',
        folder: '/data',
        members: [
          { path: '/data/z.nii.gz', name: 'z.nii.gz' },
          { path: '/data/t.nii.gz', name: 't.nii.gz' },
        ],
        activeIndex: 0,
        pendingIndex: null,
        layerId: 'layer',
        error: null,
        renderByMember: {},
      },
    },
  });
});
it('shows position, full filename, and bounded previous/next navigation', () => {
  render(<ImageSetSection item={item} />);
  expect(screen.getByRole('combobox', { name: 'Image in set' })).toHaveTextContent('z.nii.gz');
  expect(screen.getByRole('button', { name: 'Previous image' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
  expect(m.select).toHaveBeenCalledWith('set', 1);
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
});
it('distinguishes a pending choice from the image that is still visible', () => {
  useImageSetStore.setState((state) => ({ sets: { set: { ...state.sets.set, pendingIndex: 1 } } }));
  render(<ImageSetSection item={item} />);
  expect(screen.getByRole('status')).toHaveTextContent('Opening t.nii.gz');
  expect(screen.getByRole('button', { name: 'Next image' })).toBeDisabled();
  expect(screen.getByText('z.nii.gz')).toBeInTheDocument();
});
