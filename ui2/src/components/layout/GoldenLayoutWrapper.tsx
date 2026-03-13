/**
 * GoldenLayoutWrapper
 *
 * Legacy compatibility wrapper retained for callers that still import this
 * component. The active UI now mounts the layout through GoldenLayoutRoot.
 */

import React, { useEffect } from 'react';
import type { LayoutConfig } from 'golden-layout';
import { GoldenLayoutRoot } from './GoldenLayoutRoot';

interface GoldenLayoutWrapperProps {
  layoutConfig?: LayoutConfig;
  onLayoutChange?: (config: LayoutConfig) => void;
  onPanelClose?: (panelId: string) => void;
  onPanelOpen?: (panelId: string) => void;
}

export function GoldenLayoutWrapper({
  layoutConfig,
  onLayoutChange,
}: GoldenLayoutWrapperProps) {
  useEffect(() => {
    if (layoutConfig && onLayoutChange) {
      onLayoutChange(layoutConfig);
    }
  }, [layoutConfig, onLayoutChange]);

  return <GoldenLayoutRoot />;
}
