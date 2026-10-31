/** Components of the test-only fixture module (fixtureModule.ts). */
import React from 'react';

export const FixtureTool = ({ workspaceId }: { workspaceId: string }) => (
  <div data-testid="fixture-tool" data-workspace-id={workspaceId}>
    fixture tool
  </div>
);
export const FixtureInspector = () => <div data-testid="fixture-inspector">fixture inspector</div>;
export const FixtureMode = () => <div data-testid="fixture-mode">fixture mode</div>;
export const FixtureHistory = () => <div data-testid="fixture-history">fixture history</div>;
