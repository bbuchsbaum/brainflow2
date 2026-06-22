import { beforeEach, describe, expect, it } from "vitest";
import { hoverInfoService } from "@/services/HoverInfoService";
import { registerBuiltinHoverProviders } from "../index";

describe("registerBuiltinHoverProviders", () => {
  beforeEach(() => {
    hoverInfoService.clear();
  });

  it("registers the built-in provider set", () => {
    registerBuiltinHoverProviders();

    // NOTE: 'atlas' is intentionally absent — region identity is a persistent,
    // crosshair-driven status-bar readout, not a hover tooltip provider.
    expect(hoverInfoService.getRegisteredProviderIds().sort()).toEqual([
      "coords",
      "intensity",
      "neurosynth",
      "sparkline",
    ]);
  });
});
