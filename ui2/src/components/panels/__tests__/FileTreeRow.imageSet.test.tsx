import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FileTreeRow } from '../files/FileTreeRow';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { ContextMenu } from '@/components/ui/ContextMenu';
const m = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), studio: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: m.invoke }) }));
vi.mock('@/services/studio/SetStudioService', () => ({
  getSetStudioService: () => ({ openFolderOntologyInStudio: m.studio }),
}));
vi.mock('@/services/ImageSetService', () => ({
  getImageSetService: () => ({ openFolder: m.open }),
}));
it('offers the folder action before a delayed BIDS check and does not reopen a dismissed menu', async () => {
  let finish!: (isBids: boolean) => void;
  m.invoke.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  const node = {
    data: { id: '/remote/folder', path: '/remote/folder', name: 'Folder', type: 'directory' },
    level: 0,
    isOpen: false,
    toggle: vi.fn(),
  };
  render(
    <>
      <FileTreeRow node={node as never} style={{}} tree={{} as never} dragHandle={() => {}} />
      <ContextMenu />
    </>,
  );
  fireEvent.contextMenu(screen.getByText('Folder'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open as switchable layer…' }));
  expect(m.open).toHaveBeenCalledWith('/remote/folder');
  expect(useContextMenuStore.getState().isOpen).toBe(false);
  await act(async () => finish(true));
  expect(useContextMenuStore.getState().isOpen).toBe(false);
});

it('opens the clicked folder in Studio even when browser selection points elsewhere', async () => {
  m.invoke.mockResolvedValue(false);
  const node = {
    data: { id: '/mount/1002', path: '/mount/1002', name: '1002', type: 'directory' },
    level: 0,
    isOpen: false,
    toggle: vi.fn(),
  };
  render(
    <>
      <FileTreeRow node={node as never} style={{}} tree={{} as never} dragHandle={() => {}} />
      <ContextMenu />
    </>,
  );
  fireEvent.contextMenu(screen.getByText('1002'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Set Studio…' }));
  expect(m.studio).toHaveBeenCalledWith({ discoveryRoot: '/mount/1002' });
});
