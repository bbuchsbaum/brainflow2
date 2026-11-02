import React from 'react';

const Key = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded-bf-xs border border-bf-border px-1 font-mono text-bf-2xs text-bf-text-muted">
    {children}
  </kbd>
);

const HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['J', 'K', 'H', 'L'], label: 'move' },
  { keys: ['Space'], label: 'quick look' },
  { keys: ['↵'], label: 'open in viewer' },
  { keys: ['C'], label: 'compare with modal' },
  { keys: ['X'], label: 'exclude' },
  { keys: ['⌘K'], label: 'go to' },
];

/** Height of the strip under the dock. */
export const BIDS_KEY_HINTS_PX = 26;

export function BidsKeyHints() {
  return (
    <div
      className="flex h-full items-center bg-background gap-3.5 overflow-hidden whitespace-nowrap border-t border-bf-border-subtle px-3 text-bf-xs text-bf-text-muted"
      data-testid="bids-key-hints"
    >
      {HINTS.map((hint) => (
        <span key={hint.label} className="inline-flex items-center gap-1">
          {hint.keys.map((key) => (
            <Key key={key}>{key}</Key>
          ))}
          {hint.label}
        </span>
      ))}
    </div>
  );
}
