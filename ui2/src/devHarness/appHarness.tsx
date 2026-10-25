/**
 * Dev-only full-app harness (app-harness.html): boots the REAL Brainflow ui2
 * entry (main.tsx -> App, GoldenLayout, Zustand) against a deterministic
 * in-browser backend, then drives a named scenario (`?scenario=`).
 *
 * Not part of the production bundle: Vite builds only index.html; this page is
 * served by `vite` dev like the other *-harness.html fixtures.
 *
 * Order matters: storage is cleared and determinism installed before any app
 * module is evaluated, and the transport is installed before services (which
 * cache it at construction) are imported.
 */
import { clearBrowserStorage, installDeterminism } from './app/determinism';
import { createHarnessLog, noteStep } from './app/harnessLog';
import { HarnessTransport, installTauriInternalsShim } from './app/harnessTransport';
import { loadFixtures } from './app/fixtures';
import { createBackend } from './app/backend';
import { runScenario, SCENARIOS } from './app/scenarios';
import { settleInitialLayout, waitForQuiescence } from './app/readiness';

async function boot(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('scenario') ?? 'empty';
  clearBrowserStorage();
  installDeterminism();
  const log = createHarnessLog(scenario);
  document.documentElement.dataset.harnessScenario = scenario;
  // Bake-off: `?direction=` selects a palette from directions.generated.css.
  const direction = params.get('direction');
  if (direction) document.documentElement.dataset.direction = direction;

  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`Unknown harness scenario '${scenario}'. Known: ${SCENARIOS.join(', ')}`);
  }

  const fixtures = await loadFixtures();
  const backend = createBackend(fixtures);
  const transport = new HarnessTransport(backend.handlers);
  const { setTransport } = await import('@/services/transport');
  setTransport(transport);
  installTauriInternalsShim(transport);
  noteStep('transport installed');

  await import('@/main');
  noteStep('app entry imported');
  if (direction) {
    // The crosshair colour is a persisted user setting, not a CSS token; seed it from the direction.
    const crosshair = getComputedStyle(document.documentElement)
      .getPropertyValue('--bf-crosshair')
      .trim();
    const { useCrosshairSettingsStore } = await import('@/stores/crosshairSettingsStore');
    if (crosshair) useCrosshairSettingsStore.getState().updateSettings({ activeColor: crosshair });
  }
  await settleInitialLayout();

  await runScenario(scenario, { backend, fixtures });
  noteStep('scenario driven');

  await waitForQuiescence();
  log.steps.push('ready');
  window.__harnessReady = true;
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  console.error('[app-harness] boot failed:', error);
  window.__harnessFailed = message;
});
