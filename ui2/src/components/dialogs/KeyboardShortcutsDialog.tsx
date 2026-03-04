/**
 * KeyboardShortcutsDialog
 * Help panel listing all registered keyboard shortcuts grouped by category.
 * Opened via the '?' key (Shift+/).
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';
import type { ShortcutRegistration } from '@/services/KeyboardShortcutService';

interface KeyboardShortcutsDialogProps {
  onClose: () => void;
}

function formatShortcut(reg: ShortcutRegistration): string {
  const parts: string[] = [];
  const mods = reg.modifiers ?? {};
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.meta) parts.push('Cmd');
  if (mods.alt) parts.push('Alt');
  if (mods.shift) parts.push('Shift');

  let key = reg.key;
  if (key === ' ') key = 'Space';
  else if (key === 'ArrowLeft') key = '←';
  else if (key === 'ArrowRight') key = '→';
  else if (key === 'ArrowUp') key = '↑';
  else if (key === 'ArrowDown') key = '↓';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);

  return parts.join('+');
}

export function KeyboardShortcutsDialog({ onClose }: KeyboardShortcutsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const grouped = getKeyboardShortcutService().getAll();
  const categories = Object.keys(grouped).sort();

  // Close on Escape or '?'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === '?' && !e.ctrlKey && !e.metaKey)) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-sm ring-1 ring-white/10 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col"
        style={{
          backgroundColor: 'var(--app-bg-secondary, #0f172a)',
          borderColor: 'var(--app-border, #334155)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--app-border-subtle, #1e293b)' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--app-text-primary, #e2e8f0)' }}>
            Keyboard Shortcuts
          </h2>
          <button onClick={onClose} className="icon-btn" aria-label="Close dialog">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Shortcut list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground">No shortcuts registered.</p>
          )}
          {categories.map(category => (
            <section key={category}>
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: 'var(--app-text-muted, #64748b)' }}
              >
                {category}
              </h3>
              <div className="space-y-1">
                {grouped[category].map(reg => (
                  <div
                    key={reg.id}
                    className="grid grid-cols-[120px_1fr] items-center gap-3 py-1"
                  >
                    <kbd
                      className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-mono font-medium"
                      style={{
                        backgroundColor: 'var(--app-bg-tertiary, #1e293b)',
                        color: 'var(--app-text-secondary, #94a3b8)',
                        border: '1px solid var(--app-border, #334155)',
                      }}
                    >
                      {formatShortcut(reg)}
                    </kbd>
                    <span className="text-sm" style={{ color: 'var(--app-text-primary, #e2e8f0)' }}>
                      {reg.description}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer hint */}
        <div
          className="px-6 py-3 border-t text-xs text-center"
          style={{
            borderColor: 'var(--app-border-subtle, #1e293b)',
            color: 'var(--app-text-muted, #64748b)',
          }}
        >
          Press <kbd className="px-1 font-mono">?</kbd> or <kbd className="px-1 font-mono">Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
