/**
 * A test-only module exercising every contribution point. Register it with
 * `registerFixtureModule()` (idempotent) in a test file; switch it with the
 * settings store.
 */
import { defineModule } from '@/modules/api';
import { moduleRegistry } from '@/modules/registry';
import { FixtureHistory, FixtureInspector, FixtureMode, FixtureTool } from './fixtureComponents';

export const FIXTURE_TOOL = 'fixture.tool';

export const fixtureActivate = { calls: 0 };

export const fixtureModule = defineModule({
  id: 'fixture',
  title: 'Fixture',
  description: 'A module for tests.',
  version: '0.1.0',
  stage: 'preview',
  hosts: ['desktop', 'browser'],
  contributes: {
    commands: [
      {
        id: 'fixture.open',
        title: 'Open fixture',
        subtitle: 'Open the fixture tool.',
        keywords: ['fixture'],
        group: 'Fixture',
      },
    ],
    menus: { 'view/workspace': [{ command: 'fixture.open', title: 'Fixture' }] },
    workspaces: [
      {
        id: FIXTURE_TOOL,
        title: 'Fixture tool',
        label: 'Fixture',
        component: () => Promise.resolve({ default: FixtureTool }),
        inspector: () => Promise.resolve({ default: FixtureInspector }),
      },
    ],
    inspectorModes: [
      { id: 'fixture.mode', title: 'Fixture mode', component: () => Promise.resolve({ default: FixtureMode }) },
    ],
    dockTabs: [
      { id: 'fixture.history', title: 'History', component: () => Promise.resolve({ default: FixtureHistory }) },
    ],
  },
  activate: () =>
    Promise.resolve({
      activate(ctx) {
        fixtureActivate.calls += 1;
        ctx.commands.register('fixture.open', async () => {
          await ctx.workspaces.open(FIXTURE_TOOL);
        });
      },
    }),
});

export function registerFixtureModule(): void {
  if (!moduleRegistry.getModule('fixture')) moduleRegistry.register(fixtureModule);
}
