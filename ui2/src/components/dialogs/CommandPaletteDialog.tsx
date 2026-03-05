import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface CommandPaletteCommand {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  shortcut?: string;
  group?: string;
  run: () => void | Promise<void>;
}

interface CommandPaletteDialogProps {
  open: boolean;
  commands: CommandPaletteCommand[];
  onClose: () => void;
}

function matchesQuery(command: CommandPaletteCommand, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    command.title,
    command.subtitle ?? '',
    command.group ?? '',
    ...(command.keywords ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase();

  return haystack.includes(normalizedQuery);
}

export function CommandPaletteDialog({ open, commands, onClose }: CommandPaletteDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runningCommandId, setRunningCommandId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredCommands = useMemo(
    () => commands.filter((command) => matchesQuery(command, query)),
    [commands, query]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery('');
    setSelectedIndex(0);
    setRunningCommandId(null);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    if (selectedIndex < filteredCommands.length) {
      return;
    }

    setSelectedIndex(filteredCommands.length === 0 ? 0 : filteredCommands.length - 1);
  }, [filteredCommands.length, selectedIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (!containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [open, onClose]);

  const executeCommand = async (command: CommandPaletteCommand | undefined) => {
    if (!command) {
      return;
    }

    try {
      setRunningCommandId(command.id);
      await Promise.resolve(command.run());
      onClose();
    } catch (error) {
      console.error('[CommandPaletteDialog] Command failed:', command.id, error);
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
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-20" style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)' }}>
      <div
        ref={containerRef}
        className="w-full max-w-2xl overflow-hidden rounded-sm border shadow-2xl"
        style={{
          backgroundColor: 'var(--app-bg-secondary, #f8fafc)',
          borderColor: 'var(--app-border, #d1d5db)',
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--app-border-subtle, #e2e8f0)' }}>
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm outline-none"
            aria-label="Command search"
          />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close command palette">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1" role="listbox" aria-label="Command results">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">No commands match your search.</div>
          ) : (
            filteredCommands.map((command, index) => {
              const selected = index === selectedIndex;
              const running = runningCommandId === command.id;

              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm ${selected ? 'bg-accent/60' : 'hover:bg-accent/30'}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    void executeCommand(command);
                  }}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{command.title}</div>
                    {command.subtitle ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">{command.subtitle}</div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    {running ? 'Running...' : command.shortcut ?? command.group ?? ''}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t px-3 py-2 text-xs text-muted-foreground" style={{ borderColor: 'var(--app-border-subtle, #e2e8f0)' }}>
          Use ↑/↓ to navigate, Enter to run, Esc to close.
        </div>
      </div>
    </div>
  );
}
