import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { openDatasetCard, showPanel } = vi.hoisted(() => ({
  openDatasetCard: vi.fn(),
  showPanel: vi.fn(() => true),
}));
vi.mock('@/services/DatasetCardService', () => ({
  getDatasetCardService: () => ({ openDatasetCard }),
}));
vi.mock('@/services/layoutService', () => ({
  getLayoutService: () => ({ showPanel }),
}));

import {
  FOLDER_NOT_BROWSED,
  NO_SOURCE_FOLDER,
  openStudioDatasetCard,
  studioDatasetCardTarget,
} from '../studioDatasetCard';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { StudioToolbar } from '@/components/studio/StudioToolbar';
import type { SpatialFieldSetSummary } from '@/types/studio';

const ROOT = '/mnt/trillium/dsets';
const FOLDER = `${ROOT}/pcmri/derivatives/enc_rep_rsa`;
const folderSet = { discoveryRequest: { root: FOLDER } } as unknown as SpatialFieldSetSummary;
const tableSet = { discoveryRequest: undefined } as unknown as SpatialFieldSetSummary;

beforeEach(() => {
  openDatasetCard.mockClear();
  showPanel.mockClear();
  useFileBrowserStore.setState({ entries: [{ path: '/elsewhere' }, { path: ROOT }] } as never);
});
afterEach(cleanup);

describe('the dataset card of a set', () => {
  it('is the card of the set\'s source folder, under the root the Files panel browses', () => {
    expect(studioDatasetCardTarget(folderSet, [{ path: '/elsewhere' }, { path: ROOT }])).toEqual({
      available: true,
      rootPath: ROOT,
      path: FOLDER,
    });
  });

  it('is unavailable, with the reason, for a table or manifest set and for a folder no longer browsed', () => {
    expect(studioDatasetCardTarget(tableSet, [{ path: ROOT }])).toEqual({
      available: false,
      reason: NO_SOURCE_FOLDER,
    });
    expect(studioDatasetCardTarget(folderSet, [{ path: '/elsewhere' }])).toEqual({
      available: false,
      reason: FOLDER_NOT_BROWSED,
    });
  });

  it('opens the existing card host beside the Files panel, returning focus to the header', () => {
    const from = document.createElement('button');
    openStudioDatasetCard(folderSet, from);
    expect(showPanel).toHaveBeenCalledWith('FileBrowser');
    expect(openDatasetCard).toHaveBeenCalledWith({ rootPath: ROOT, path: FOLDER, returnFocus: from });
    openDatasetCard.mockClear();
    expect(openStudioDatasetCard(tableSet, from)).toEqual({
      available: false,
      reason: NO_SOURCE_FOLDER,
    });
    expect(openDatasetCard).not.toHaveBeenCalled();
  });
});

describe('the set name in the studio header', () => {
  it('is a button opening the card when the set has one', () => {
    const onOpen = vi.fn((from: HTMLElement) => openStudioDatasetCard(folderSet, from));
    render(<StudioToolbar setName="enc_rep_rsa" onOpenDatasetCard={onOpen} />);
    const name = screen.getByRole('button', { name: 'enc_rep_rsa: about this dataset' });
    expect(name).toHaveAttribute('data-testid', 'studio-set-name');
    fireEvent.click(name);
    expect(onOpen).toHaveBeenCalledWith(name);
    expect(openDatasetCard).toHaveBeenCalledWith({ rootPath: ROOT, path: FOLDER, returnFocus: name });
  });

  it('is plain text when it has none', () => {
    render(<StudioToolbar setName="table set" />);
    expect(screen.queryByRole('button', { name: /about this dataset/ })).toBeNull();
    expect(screen.getByTestId('studio-set-name').tagName).toBe('DIV');
  });
});
