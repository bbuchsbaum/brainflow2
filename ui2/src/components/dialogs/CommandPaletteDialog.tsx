import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { IconButton, SELECTED_EDGE } from '@/components/ui/bf';
import { getEventBus } from '@/events/EventBus';
import { formatTauriError } from '@/utils/formatTauriError';
import { formatShortcut, rankCommands } from './commandPaletteMatch';
import { paletteView } from './paletteView';
import type { CommandPaletteCommand } from './paletteView';

export type { CommandPaletteCommand };

/** Two frames: the closing Modal has unmounted and returned focus. */
function afterFocusReturn(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

interface CommandPaletteDialogProps {
  open: boolean;
  commands: CommandPaletteCommand[];
  onClose: () => void;
  placeholder?: string;
}

export function CommandPaletteDialog({ open, commands, onClose, placeholder }: CommandPaletteDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runningCommandId, setRunningCommandId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ranking a large dataset must not hold up the keystroke that asked for it.
  const deferredQuery = useDeferredValue(query);
  const sectioned = useMemo(() => commands.some((command) => command.section), [commands]);
  const view = useMemo(
    () => paletteView(rankCommands(commands, deferredQuery), sectioned),
    [commands, deferredQuery, sectioned],
  );
  const filteredCommands = view.visible;

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery('');
    setSelectedIndex(0);
    setRunningCommandId(null);

    requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      // Caret at the end: never select (and so replace) keys typed meanwhile.
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }, [open]);

  // Keys typed while the palette opens (before its field has focus) belong
  // to the query, never to the app's single-key shortcuts: typing
  // "radiological" fast after ⌘K ran O (go to origin) and L (hide the
  // orientation letters) (QA 2026-10-31 N14).
  useEffect(() => {
    if (!open) return;
    // On window, capture: ahead of every document listener (the slice
    // views' Space-to-pan among them), which then never sees the key.
    const capture = (event: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || event.target === input) return;
      // An input method composing a character delivers it to the field.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setQuery((current) => current + event.key);
      input.focus();
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [open]);

  useEffect(() => {
    if (selectedIndex < filteredCommands.length) {
      return;
    }

    setSelectedIndex(filteredCommands.length === 0 ? 0 : filteredCommands.length - 1);
  }, [filteredCommands.length, selectedIndex]);

  const executeCommand = async (
    command: CommandPaletteCommand | undefined,
    action: 'run' | 'select' = 'run',
  ) => {
    if (!command) {
      return;
    }

    // Close first and let the palette restore focus, THEN run the command:
    // a command that opens a dialog (Export, Go to, Crosshair settings) or
    // moves focus (Show Clusters) must not have its focus undone by the
    // palette's own focus return (v3 function critic).
    setRunningCommandId(command.id);
    onClose();
    await afterFocusReturn();
    try {
      await Promise.resolve(action === 'select' && command.select ? command.select() : command.run());
    } catch (error) {
      console.error('[CommandPaletteDialog] Command failed:', command.id, error);
      // Failures are shown (status message, role=alert), not only logged.
      getEventBus().emit('ui.notification', {
        type: 'error',
        message: `${command.title}: ${formatTauriError(error) || 'failed'}`,
      });
    } finally {
      setRunningCommandId(null);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => {
        if (filteredCommands.length === 0) {
          return 0;
        }
        return Math.min(current + 1, filteredCommands.length - 1);
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void executeCommand(filteredCommands[selectedIndex]);
      return;
    }

    if (event.key === 'Tab' && !event.shiftKey && filteredCommands[selectedIndex]?.select) {
      event.preventDefault();
      void executeCommand(filteredCommands[selectedIndex], 'select');
    }
  };

  if (!open) {
    return null;
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      ariaLabel="Command palette"
      size="full"
      showCloseButton={false}
      initialFocusRef={inputRef}
      bodyClassName="p-0"
      overlayClassName="items-start pt-20 bg-black/55"
      className="!max-w-2xl overflow-hidden rounded-sm border shadow-2xl"
    >
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--bf-border-subtle)' }}>
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? 'Search commands...'}
            className="flex-1 bg-transparent text-sm outline-none"
            aria-label="Command search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <IconButton size="xs" icon={<X />} onClick={onClose} aria-label="Close command palette" />
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1" role="listbox" aria-label="Command results">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">No commands match your search.</div>
          ) : (
            filteredCommands.map((command, index) => {
              const selected = index === selectedIndex;
              const running = runningCommandId === command.id;
              const section = view.sections.get(index);
              const hidden = view.hidden.get(index);

              return (
                <React.Fragment key={command.id}>
                  {section ? (
                    <div className="px-3 pb-1 pt-2 text-xs text-muted-foreground" role="presentation">
                      {section.title}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm ${selected ? `bg-accent ${SELECTED_EDGE}` : 'hover:bg-accent'}`}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => {
                      void executeCommand(command, 'select');
                    }}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">
                        {command.title}
                        {command.badge ? (
                          <span className="ml-2 rounded-bf-xs bg-bf-bg-panel-raised px-1 font-mono text-bf-2xs text-bf-text-secondary">
                            {command.badge}
                          </span>
                        ) : null}
                      </div>
                      {command.subtitle ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">{command.subtitle}</div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-bf-2xs text-muted-foreground">
                      {running
                        ? 'Running...'
                        : command.select && selected
                          ? '⇥ select · ↵ open in viewer'
                          : (command.hint ??
                            (command.shortcut
                              ? formatShortcut(command.shortcut)
                              : (command.group ?? '')))}
                    </div>
                  </button>
                  {hidden ? (
                    <div className="px-3 py-1 text-bf-2xs text-muted-foreground" role="presentation">
                      {hidden} more. Keep typing to narrow.
                    </div>
                  ) : null}
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="border-t px-3 py-2 text-xs text-muted-foreground" style={{ borderColor: 'var(--bf-border-subtle)' }}>
          Use ↑/↓ to navigate, Enter to run, Tab or click to select a run, Esc to close.
        </div>
    </Modal>
  );
}
