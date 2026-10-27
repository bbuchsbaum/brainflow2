import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AtlasPaletteLegendEntry } from "@/types/atlasPalette";

vi.mock("../SamplingService", () => ({
  sampleLayerAtWorld: vi.fn(),
}));

// Minimal controllable layerStore mock: only getState().layers is used.
const layersRef: { current: unknown[] } = { current: [] };
vi.mock("@/stores/layerStore", () => ({
  useLayerStore: {
    getState: () => ({ layers: layersRef.current }),
  },
}));

import * as SamplingService from "../SamplingService";
import {
  resolveAtlasRegionAtWorld,
  formatRegionLabel,
  findActiveAtlasLayer,
} from "../atlasRegionLookup";

const mockSample = SamplingService.sampleLayerAtWorld as ReturnType<
  typeof vi.fn
>;

const legend: AtlasPaletteLegendEntry[] = [
  {
    label_id: 1,
    roi: "VisCent_ExStr_1",
    color: [1, 2, 3],
    network: "VisCent",
    hemisphere: "left",
  },
  {
    label_id: 7,
    roi: "Default_PCC_2",
    color: [4, 5, 6],
    network: "Default",
    hemisphere: "right",
  },
];

function atlasLayer(overrides: Record<string, unknown> = {}) {
  return {
    id: "atlas-1",
    type: "label",
    atlasMetadata: { id: "schaefer" },
    atlasPaletteLegend: legend,
    ...overrides,
  };
}

describe("atlasRegionLookup", () => {
  beforeEach(() => {
    mockSample.mockReset();
    layersRef.current = [];
  });

  describe("formatRegionLabel", () => {
    it("prefixes hemisphere and spaces underscores", () => {
      expect(formatRegionLabel(legend[0])).toBe("LH VisCent ExStr 1");
      expect(formatRegionLabel(legend[1])).toBe("RH Default PCC 2");
    });

    it("omits hemisphere when unknown", () => {
      expect(
        formatRegionLabel({ label_id: 9, roi: "Foo_Bar", color: [0, 0, 0] }),
      ).toBe("Foo Bar");
    });
  });

  describe("findActiveAtlasLayer", () => {
    it("finds the label layer carrying atlas metadata", () => {
      layersRef.current = [{ id: "v", type: "volume" }, atlasLayer()];
      expect(findActiveAtlasLayer()?.id).toBe("atlas-1");
    });

    it("returns undefined when there is no atlas layer", () => {
      layersRef.current = [{ id: "v", type: "volume" }];
      expect(findActiveAtlasLayer()).toBeUndefined();
    });
  });

  describe("resolveAtlasRegionAtWorld", () => {
    it("returns null and does not sample when there is no atlas layer", async () => {
      layersRef.current = [];
      expect(await resolveAtlasRegionAtWorld([0, 0, 0])).toBeNull();
      expect(mockSample).not.toHaveBeenCalled();
    });

    it("returns null when the atlas layer has no legend", async () => {
      layersRef.current = [atlasLayer({ atlasPaletteLegend: undefined })];
      expect(await resolveAtlasRegionAtWorld([0, 0, 0])).toBeNull();
      expect(mockSample).not.toHaveBeenCalled();
    });

    it("rounds the sampled value and looks it up in the legend", async () => {
      layersRef.current = [atlasLayer()];
      mockSample.mockResolvedValue({ value: 0.97 }); // nearest-voxel noise -> 1
      const hit = await resolveAtlasRegionAtWorld([1, 2, 3]);
      expect(mockSample).toHaveBeenCalledWith({
        layerId: "atlas-1",
        world: [1, 2, 3],
      });
      expect(hit?.labelId).toBe(1);
      expect(hit?.entry.roi).toBe("VisCent_ExStr_1");
    });

    it("returns null for background (label 0)", async () => {
      layersRef.current = [atlasLayer()];
      mockSample.mockResolvedValue({ value: 0 });
      expect(await resolveAtlasRegionAtWorld([1, 2, 3])).toBeNull();
    });

    it("returns null for an unmapped label id", async () => {
      layersRef.current = [atlasLayer()];
      mockSample.mockResolvedValue({ value: 999 });
      expect(await resolveAtlasRegionAtWorld([1, 2, 3])).toBeNull();
    });

    it("returns null when sampling yields a null value", async () => {
      layersRef.current = [atlasLayer()];
      mockSample.mockResolvedValue({ value: null });
      expect(await resolveAtlasRegionAtWorld([1, 2, 3])).toBeNull();
    });
  });
});

describe("user-loaded label tables (P3 item 4)", () => {
  it("finds a label layer that has only a sidecar legend and shows its names verbatim", async () => {
    layersRef.current = [
      { id: "t1", type: "volume" },
      {
        id: "dseg",
        type: "label",
        atlasPaletteLegend: [
          { label_id: 2, roi: "R_occipitotemporal", displayName: "R_occipitotemporal", color: [0, 0, 0] },
        ],
      },
    ];
    expect(findActiveAtlasLayer()?.id).toBe("dseg");
    mockSample.mockResolvedValue({ value: 2 });
    const hit = await resolveAtlasRegionAtWorld([42.5, -59.5, -9.5]);
    expect(hit?.labelId).toBe(2);
    expect(formatRegionLabel(hit!.entry)).toBe("R_occipitotemporal");
  });

  it("ignores label layers with neither atlas metadata nor a legend", () => {
    layersRef.current = [{ id: "seg", type: "label" }];
    expect(findActiveAtlasLayer()).toBeUndefined();
  });
});
