/**
 * KeyboardShortcutsDialog
 * Help panel listing all registered keyboard shortcuts grouped by category.
 * Opened via the '?' key (Shift+/).
 */

import React, { useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';
import type { ShortcutRegistration } from '@/services/KeyboardShortcutService';
import { platformShortcuts, shortcutLabel } from './shortcutLabels';
import { VIEW_GESTURES } from './viewGestures';

interface KeyboardShortcutsDialogProps {
  onClose: () => void;
}

export function KeyboardShortcutsDialog({ onClose }: KeyboardShortcutsDialogProps) {
  const grouped = getKeyboardShortcutService().getAll();
  const categories = Object.keys(grouped).sort();

  // Close on '?' in addition to the shared modal Escape handling.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Keyboard shortcuts"
      ariaLabel="Keyboard shortcuts"
      size="md"
      bodyClassName="p-0"
      className="max-w-md rounded-sm ring-1 ring-bf-border-strong shadow-2xl"
    >
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground">No shortcuts registered.</p>
          )}
          {categories.map(category => (
            <section key={category}>
              <h3 className="m-0 mb-3 border-0 p-0 text-bf-sm font-semibold text-foreground">
                {category}
              </h3>
              <div className="space-y-1">
                {platformShortcuts(grouped[category]).map(reg => (
                  <div
                    key={reg.id}
                    className="grid grid-cols-[120px_1fr] items-center gap-3 py-1"
                  >
                    <kbd
                      className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-mono font-medium"
                      style={{
                        backgroundColor: 'var(--bf-bg-panel)',
                        color: 'var(--bf-text-secondary)',
                        border: '1px solid var(--bf-border)',
                      }}
                    >
                      {shortcutLabel(reg)}
                    </kbd>
                    <span className="text-sm" style={{ color: 'var(--bf-text-primary)' }}>
                      {reg.description}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {/* Zoom, pan and the other pointer gestures of the slice views. */}
          <section>
            <h3 className="m-0 mb-3 border-0 p-0 text-bf-sm font-semibold text-foreground">
              Mouse and trackpad
            </h3>
            <div className="space-y-1">
              {VIEW_GESTURES.map(item => (
                <div key={item.id} className="grid grid-cols-[120px_1fr] items-center gap-3 py-1">
                  <kbd
                    className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-mono font-medium"
                    style={{
                      backgroundColor: 'var(--bf-bg-panel)',
                      color: 'var(--bf-text-secondary)',
                      border: '1px solid var(--bf-border)',
                    }}
                  >
                    {item.gesture}
                  </kbd>
                  <span className="text-sm" style={{ color: 'var(--bf-text-primary)' }}>
                    {item.description}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer hint */}
        <div
          className="px-6 py-3 border-t text-xs text-center"
          style={{
            borderColor: 'var(--bf-border-subtle)',
            color: 'var(--bf-text-muted)',
          }}
        >
          Press <kbd className="px-1 font-mono">?</kbd> or <kbd className="px-1 font-mono">Esc</kbd> to close
        </div>
    </Modal>
  );
}
