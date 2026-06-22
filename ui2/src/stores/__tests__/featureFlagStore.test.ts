import { describe, it, expect } from "vitest";

import {
  migrateFeatureFlags,
  useFeatureFlagStore,
} from "@/stores/featureFlagStore";

describe("featureFlagStore", () => {
  it("enables the integrated workspace by default (vol2surf M2)", () => {
    expect(useFeatureFlagStore.getState().integratedWorkspaceV1).toBe(true);
  });

  it("migrate v0 -> v1 force-enables integratedWorkspaceV1 even when persisted off", () => {
    const migrated = migrateFeatureFlags(
      { multiViewBatch: false, integratedWorkspaceV1: false },
      0,
    );
    expect(migrated.integratedWorkspaceV1).toBe(true);
    // unrelated flags are preserved
    expect(migrated.multiViewBatch).toBe(false);
  });

  it("migrate at the current version leaves a user opt-out untouched", () => {
    const migrated = migrateFeatureFlags(
      { multiViewBatch: true, integratedWorkspaceV1: false },
      1,
    );
    expect(migrated.integratedWorkspaceV1).toBe(false);
    expect(migrated.multiViewBatch).toBe(true);
  });
});
