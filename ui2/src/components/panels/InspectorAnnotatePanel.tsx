/**
 * InspectorAnnotatePanel — Phase 6a of the integrated workspace refactor.
 *
 * Layer-following shell with a top mode toggle (Inspector | Annotate).
 * The shell owns:
 *   - the mode toggle (Annotate is a *task mode*, not a data-type tab —
 *     this intentionally replaces the older Surface|Volume|Atlas|Annotate
 *     top-level tab strip from the original mockup);
 *   - the active-layer header (auto-switches when `selectedLayerId` changes);
 *   - the empty state when no layer is selected;
 *   - chrome and theme tokens.
 *
 * The shell does NOT own content sections — those land in mote 6b. For now,
 * each mode renders a small placeholder so 6b can swap in the real Inspector
 * details (volume metadata, mask / label region tools, atlas region info,
 * etc.) and the Annotate panel content (annotation tools and state) without
 * touching the shell.
 */

import React, { useCallback, useEffect, useState } from 'react';

import {
  type InspectorAnnotateMode,
  useActiveLayerSummary,
} from './inspectorAnnotatePanel.helpers';
import { LayerInspectorContent } from './LayerInspectorContent';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';

const MODE_DEFINITIONS: ReadonlyArray<{ id: InspectorAnnotateMode; label: string }> = [
  { id: 'inspector', label: 'Inspector' },
  { id: 'annotate', label: 'Annotate' },
];

const HEADER_HEIGHT = 28;

export interface InspectorAnnotatePanelProps {
  /** Initial mode on first mount. Defaults to `'inspector'`. */
  defaultMode?: InspectorAnnotateMode;
  /** Optional className appended to the panel root. */
  className?: string;
  /** Notified when the active mode changes (controlled or uncontrolled). */
  onModeChange?: (mode: InspectorAnnotateMode) => void;
}

interface ModeToggleProps {
  active: InspectorAnnotateMode;
  onChange: (mode: InspectorAnnotateMode) => void;
}

function ModeToggle({ active, onChange }: ModeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Inspector mode"
      data-testid="inspector-annotate-mode-toggle"
      style={{ display: 'inline-flex', gap: '2px' }}
    >
      {MODE_DEFINITIONS.map(({ id, label }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`inspector-annotate-mode-${id}`}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onChange(id)}
            className="bf-role-section"
            style={{
              appearance: 'none',
              padding: '2px 10px',
              height: '20px',
              border: '1px solid var(--app-border)',
              borderColor: isActive ? 'var(--app-border-active)' : 'var(--app-border)',
              background: isActive ? 'var(--app-bg-active)' : 'transparent',
              color: isActive ? 'var(--app-text-primary)' : 'var(--app-text-muted)',
              cursor: 'pointer',
              borderRadius: 'var(--app-radius-sm)',
              fontSize: 'var(--app-role-section-size)',
              letterSpacing: 'var(--app-role-section-tracking)',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '0 8px',
  height: `${HEADER_HEIGHT}px`,
  minHeight: `${HEADER_HEIGHT}px`,
  borderBottom: '1px solid var(--app-border-subtle)',
  flex: '0 0 auto',
};

const BODY_STYLE: React.CSSProperties = {
  position: 'relative',
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'auto',
  padding: '12px',
  color: 'var(--app-text-primary)',
};

const EMPTY_STATE_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  textAlign: 'center',
  color: 'var(--app-text-muted)',
  padding: '12px',
  userSelect: 'none',
};

const PLACEHOLDER_STYLE: React.CSSProperties = {
  fontSize: 'var(--app-role-body-size)',
  color: 'var(--app-text-disabled)',
  lineHeight: 1.4,
  maxWidth: '32ch',
};

const InspectorAnnotatePanelContent: React.FC<InspectorAnnotatePanelProps> = ({
  defaultMode = 'inspector',
  className,
  onModeChange,
}) => {
  const [mode, setMode] = useState<InspectorAnnotateMode>(defaultMode);
  const layer = useActiveLayerSummary();

  const handleModeChange = useCallback(
    (next: InspectorAnnotateMode) => {
      setMode(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );

  // If the parent changes `defaultMode` after mount it should re-seed the mode.
  useEffect(() => {
    setMode(defaultMode);
  }, [defaultMode]);

  const showEmptyState = !layer;

  return (
    <div
      data-testid="inspector-annotate-panel"
      data-mode={mode}
      data-layer-id={layer?.id ?? ''}
      data-layer-kind={layer?.kind ?? ''}
      className={className ? `bf-inspector-annotate ${className}` : 'bf-inspector-annotate'}
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--app-surface-panel-raised)',
        color: 'var(--app-text-primary)',
        overflow: 'hidden',
      }}
    >
      <div data-testid="inspector-annotate-header" style={HEADER_STYLE}>
        <ModeToggle active={mode} onChange={handleModeChange} />
        {layer ? (
          <div
            data-testid="inspector-annotate-layer-summary"
            className="bf-role-section"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--app-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--app-role-section-tracking)',
              fontSize: 'var(--app-role-section-size)',
              minWidth: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
            title={`${layer.name} — ${layer.typeLabel}`}
          >
            <span data-testid="inspector-annotate-layer-name" style={{ color: 'var(--app-text-primary)' }}>
              {layer.name}
            </span>
            <span aria-hidden="true">·</span>
            <span data-testid="inspector-annotate-layer-kind">{layer.typeLabel}</span>
          </div>
        ) : null}
      </div>

      <div data-testid="inspector-annotate-body" style={BODY_STYLE}>
        {showEmptyState ? (
          <div
            data-testid="inspector-annotate-empty"
            data-mode={mode}
            style={EMPTY_STATE_STYLE}
          >
            <span
              className="bf-role-section"
              style={{
                color: 'var(--app-text-muted)',
                letterSpacing: 'var(--app-role-section-tracking)',
                textTransform: 'uppercase',
              }}
            >
              No layer selected
            </span>
            <span style={PLACEHOLDER_STYLE}>
              {mode === 'inspector'
                ? 'Select a layer to inspect its details, metadata, and controls.'
                : 'Select a layer to add or edit annotations.'}
            </span>
          </div>
        ) : mode === 'inspector' ? (
          // 6b plugs the real layer-driven content here. The wrapper's testid
          // remains stable so 6a's contract continues to hold; future motes
          // (6c) replace the body, not the placeholder envelope.
          <div
            data-testid="inspector-content-placeholder"
            data-layer-id={layer.id}
            data-layer-kind={layer.kind}
          >
            <LayerInspectorContent layer={layer} />
          </div>
        ) : (
          <div
            data-testid="annotate-content-placeholder"
            data-layer-id={layer.id}
            style={PLACEHOLDER_STYLE}
          >
            Annotate tools will appear here once the 6c content modules land.
          </div>
        )}
      </div>
    </div>
  );
};

export const InspectorAnnotatePanel: React.FC<InspectorAnnotatePanelProps> = (props) => (
  <PanelErrorBoundary panelName="InspectorAnnotatePanel">
    <InspectorAnnotatePanelContent {...props} />
  </PanelErrorBoundary>
);

export default InspectorAnnotatePanel;
