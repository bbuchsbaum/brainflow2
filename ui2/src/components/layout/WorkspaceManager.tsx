/**
 * WorkspaceManager
 *
 * Legacy compatibility entry point. Workspace and tab management are now owned
 * by GoldenLayoutRoot directly.
 */

import React from 'react';
import { GoldenLayoutRoot } from './GoldenLayoutRoot';

export function WorkspaceManager() {
  return <GoldenLayoutRoot />;
}
