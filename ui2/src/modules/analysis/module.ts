/**
 * The Analysis module: runs builtin and sidecar analyses (core/modules/analysis,
 * bridge adapter core/api_bridge/src/modules/analysis.rs) on the selected
 * volume and opens their outputs.
 *
 * Stage: experimental, off by default (owner decision 2026-10-31: it ships
 * only demo analyses). Switched on in Settings › Modules it appears where
 * Analysis always was: the Workspace menu, View › Workspace › Analysis and the
 * command palette. No pin, no startup tab, no global shortcut.
 */

import { defineModule } from '@/modules/api';

/** The tool tab's type; persisted in saved workspaces since before modules. */
export const ANALYSIS_WORKBENCH = 'analysis-workbench';

export default defineModule({
  id: 'analysis',
  title: 'Analysis',
  description: 'Run builtin and sidecar analyses on the selected volume and open their outputs.',
  version: '0.1.0',
  stage: 'experimental',
  hosts: ['desktop'],
  contributes: {
    commands: [
      {
        id: 'analysis.open',
        title: 'Open analysis',
        subtitle: 'Inspect available analyses and run them against the selected volume.',
        keywords: ['analysis', 'workbench', 'jobs', 'plugin'],
        group: 'Analysis',
      },
    ],
    menus: { 'view/workspace': [{ command: 'analysis.open', title: 'Analysis' }] },
    workspaces: [
      {
        id: ANALYSIS_WORKBENCH,
        legacyId: true,
        title: 'Analysis Workbench',
        label: 'Analysis',
        // The shared dock, as in every centre tab (QA 2026-10-30 F31).
        bottomDock: true,
        component: () =>
          import('./components/AnalysisWorkbenchWorkspace').then((m) => ({
            default: m.AnalysisWorkbenchWorkspace,
          })),
        inspector: () =>
          import('./components/AnalysisInspector').then((m) => ({ default: m.AnalysisInspector })),
      },
    ],
  },
  activate: () => import('./activate'),
});
