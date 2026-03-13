import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutsDialog } from '../KeyboardShortcutsDialog';
import type { ShortcutRegistration } from '@/services/KeyboardShortcutService';

const { mockGetAll } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
}));

vi.mock('@/services/KeyboardShortcutService', () => ({
  getKeyboardShortcutService: () => ({
    getAll: mockGetAll,
  }),
}));

describe('KeyboardShortcutsDialog', () => {
  beforeEach(() => {
    mockGetAll.mockReset();
  });

  it('renders grouped shortcut entries with formatted key chords', () => {
    const onClose = vi.fn();
    const navigationShortcut: ShortcutRegistration = {
      id: 'nav.left',
      category: 'Navigation',
      description: 'Move left',
      key: 'ArrowLeft',
      modifiers: { ctrl: true, shift: true },
      handler: vi.fn(),
    };
    const generalShortcut: ShortcutRegistration = {
      id: 'general.help',
      category: 'General',
      description: 'Open help',
      key: '?',
      modifiers: { shift: true },
      handler: vi.fn(),
    };

    mockGetAll.mockReturnValue({
      Navigation: [navigationShortcut],
      General: [generalShortcut],
    });

    render(<KeyboardShortcutsDialog onClose={onClose} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+←')).toBeInTheDocument();
    expect(screen.getByText('Shift+?')).toBeInTheDocument();
    expect(screen.getByText('Move left')).toBeInTheDocument();
    expect(screen.getByText('Open help')).toBeInTheDocument();
  });

  it('closes on question-mark shortcut and overlay click', async () => {
    const onClose = vi.fn();
    mockGetAll.mockReturnValue({});

    render(<KeyboardShortcutsDialog onClose={onClose} />);

    fireEvent.keyDown(window, { key: '?' });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(dialog.parentElement!);
    });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
