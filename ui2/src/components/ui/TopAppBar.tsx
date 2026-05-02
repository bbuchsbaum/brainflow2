/**
 * TopAppBar — mockup7 top app chrome (Design.md §6, §15).
 *
 * Houses the brand mark, the display-mode selector, and any utility
 * actions that don't belong in the coordinate-focused status bar.
 * Replaces the previous practice of mounting the display-mode selector
 * in the status bar's right slot, satisfying AC#2 of the Mockup7
 * convergence mote (`bd-01KQK37ZYCKC3V7GX2KBWJ3X3A`).
 *
 * Layout (Design.md §6.1):
 *
 *   [Brand]   [Display Mode Selector]   [Workspace · Utility actions]
 *
 * Native OS menus (File / Edit / View / Tools / Window / Help) live in
 * the Tauri title bar, not here.
 */

import React from 'react';

import { DisplayModeSelector } from '@/components/ui/DisplayModeSelector';
import { LayoutLibrarySelector } from '@/components/ui/LayoutLibrarySelector';
import { WorkspacePresetSelector } from '@/components/ui/WorkspacePresetSelector';
import { MultiViewBatchToggle } from '@/components/ui/MultiViewBatchToggle';

const TOP_BAR_HEIGHT = 40;

export interface TopAppBarProps {
  /** Optional extra content rendered between the brand and the display mode selector. */
  centerStart?: React.ReactNode;
  /** Optional extra utility content rendered to the right of the workspace selectors. */
  utility?: React.ReactNode;
  className?: string;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  centerStart,
  utility,
  className,
}) => {
  return (
    <header
      data-testid="top-app-bar"
      className={className ? `bf-top-app-bar ${className}` : 'bf-top-app-bar'}
      style={{
        height: `${TOP_BAR_HEIGHT}px`,
        minHeight: `${TOP_BAR_HEIGHT}px`,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        gap: '16px',
        padding: '0 12px',
        borderBottom: '1px solid var(--bf-border-subtle)',
        background: 'var(--bf-bg-shell)',
        color: 'var(--bf-text-primary)',
        flex: '0 0 auto',
      }}
    >
      <div
        data-testid="top-app-bar-brand"
        style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
      >
        <span
          aria-hidden
          style={{
            width: '20px',
            height: '20px',
            borderRadius: 'var(--bf-radius-sm)',
            background: 'linear-gradient(135deg, var(--bf-accent), var(--bf-brand))',
            boxShadow: 'var(--bf-shadow-inset)',
          }}
        />
        <span
          style={{
            fontSize: '14px',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--bf-text-primary)',
          }}
        >
          BrainFlow
        </span>
      </div>

      <div
        data-testid="top-app-bar-center"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          justifyContent: 'center',
          minWidth: 0,
        }}
      >
        {centerStart}
        <DisplayModeSelector />
      </div>

      <div
        data-testid="top-app-bar-utility"
        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <LayoutLibrarySelector />
        <WorkspacePresetSelector />
        <MultiViewBatchToggle />
        {utility}
      </div>
    </header>
  );
};

export default TopAppBar;
