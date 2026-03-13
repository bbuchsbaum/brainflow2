import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutLibrarySelector } from '../LayoutLibrarySelector';

const {
  mockPromptLayoutSaveName,
  mockPromptLayoutRename,
  mockConfirmLayoutDeletion,
  mockShowError,
} = vi.hoisted(() => ({
  mockPromptLayoutSaveName: vi.fn(),
  mockPromptLayoutRename: vi.fn(),
  mockConfirmLayoutDeletion: vi.fn(),
  mockShowError: vi.fn(),
}));

const layoutStoreState = vi.hoisted(() => ({
  layouts: [
    {
      id: 'layout-1',
      name: 'Layout One',
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      layoutConfig: { root: {} },
    },
  ],
  activeLayoutId: 'layout-1',
  lastError: null as string | null,
  saveCurrentLayout: vi.fn(),
  loadLayout: vi.fn(),
  renameLayout: vi.fn(),
  deleteLayout: vi.fn(),
  clearError: vi.fn(),
}));

vi.mock('@/services/ConfirmationService', () => ({
  getConfirmationService: () => ({
    promptLayoutSaveName: mockPromptLayoutSaveName,
    promptLayoutRename: mockPromptLayoutRename,
    confirmLayoutDeletion: mockConfirmLayoutDeletion,
    showError: mockShowError,
  }),
}));

vi.mock('@/stores/layoutLibraryStore', () => ({
  useLayoutLibraryStore: (selector: (state: typeof layoutStoreState) => unknown) =>
    selector(layoutStoreState),
  getLayoutLibraryLastError: () => layoutStoreState.lastError,
}));

vi.mock('../DropdownMenu', () => ({
  DropdownMenu: ({
    trigger,
    items,
  }: {
    trigger: React.ReactNode;
    items: Array<{
      id: string;
      label?: React.ReactNode;
      separator?: boolean;
      disabled?: boolean;
      onClick?: () => void;
    }>;
  }) => (
    <div>
      <div>{trigger}</div>
      <div>
        {items
          .filter((item) => !item.separator)
          .map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={item.onClick}
            >
              {typeof item.label === 'string' ? item.label : item.id}
            </button>
          ))}
      </div>
    </div>
  ),
}));

describe('LayoutLibrarySelector', () => {
  beforeEach(() => {
    layoutStoreState.layouts = [
      {
        id: 'layout-1',
        name: 'Layout One',
        schemaVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        layoutConfig: { root: {} },
      },
    ];
    layoutStoreState.activeLayoutId = 'layout-1';
    layoutStoreState.lastError = null;
    layoutStoreState.saveCurrentLayout.mockReset();
    layoutStoreState.loadLayout.mockReset();
    layoutStoreState.renameLayout.mockReset();
    layoutStoreState.deleteLayout.mockReset();
    layoutStoreState.clearError.mockReset();
    mockPromptLayoutSaveName.mockReset();
    mockPromptLayoutRename.mockReset();
    mockConfirmLayoutDeletion.mockReset();
    mockShowError.mockReset();
  });

  it('routes save through the prompt helper', () => {
    mockPromptLayoutSaveName.mockResolvedValue('Saved Layout');
    layoutStoreState.saveCurrentLayout.mockReturnValue(true);

    render(<LayoutLibrarySelector />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Current Layout…' }));

    return waitFor(() => {
      expect(mockPromptLayoutSaveName).toHaveBeenCalledTimes(1);
      expect(layoutStoreState.saveCurrentLayout).toHaveBeenCalledWith('Saved Layout');
    });
  });

  it('routes rename through the prompt helper', () => {
    mockPromptLayoutRename.mockResolvedValue('Renamed Layout');
    layoutStoreState.renameLayout.mockReturnValue(true);

    render(<LayoutLibrarySelector />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename: Layout One' }));

    return waitFor(() => {
      expect(mockPromptLayoutRename).toHaveBeenCalledWith('Layout One');
      expect(layoutStoreState.renameLayout).toHaveBeenCalledWith('layout-1', 'Renamed Layout');
    });
  });

  it('routes deletion through the confirmation helper', async () => {
    mockConfirmLayoutDeletion.mockResolvedValue(true);
    layoutStoreState.deleteLayout.mockReturnValue(true);

    render(<LayoutLibrarySelector />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete: Layout One' }));

    await waitFor(() => {
      expect(mockConfirmLayoutDeletion).toHaveBeenCalledWith('Layout One');
      expect(layoutStoreState.deleteLayout).toHaveBeenCalledWith('layout-1');
    });
  });

  it('shows and clears the last error when a save fails', () => {
    mockPromptLayoutSaveName.mockResolvedValue('Saved Layout');
    layoutStoreState.saveCurrentLayout.mockReturnValue(false);
    layoutStoreState.lastError = 'Layout failed to save.';

    render(<LayoutLibrarySelector />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Current Layout…' }));

    return waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Layout failed to save.');
      expect(layoutStoreState.clearError).toHaveBeenCalledTimes(1);
    });
  });
});
