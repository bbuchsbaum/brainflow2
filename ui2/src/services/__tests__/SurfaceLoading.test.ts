import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurfaceLoadingService } from "@/services/SurfaceLoadingService";
import { useSurfaceStore } from "@/stores/surfaceStore";

const mockInvoke = vi.fn();

vi.mock("@/services/transport", () => ({
  getTransport: () => ({
    invoke: mockInvoke,
  }),
  TauriTransport: class {
    getNamespacedCommand(command: string) {
      return `plugin:api-bridge|${command}`;
    }
  },
}));

describe("SurfaceLoadingService", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useSurfaceStore.getState().setLoadingState(false, null);
  });

  it("opens the canonical file dialog for surface selection", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const service = new SurfaceLoadingService();

    await service.requestSurfaceFileSelection();

    expect(mockInvoke).toHaveBeenCalledWith("open_file_dialog");
  });

  it("accepts both .gii and .gifti surface files during validation", async () => {
    const service = new SurfaceLoadingService();

    await expect(service.validateSurfaceFile("/tmp/lh.pial.gii")).resolves.toBe(
      true,
    );
    await expect(
      service.validateSurfaceFile("/tmp/lh.pial.gifti"),
    ).resolves.toBe(true);
    await expect(service.validateSurfaceFile("/tmp/lh.pial.obj")).resolves.toBe(
      false,
    );
  });

  it("keeps the namespaced surface commands stable", async () => {
    const { TauriTransport } = await import("@/services/transport");
    const transport = new TauriTransport();

    expect((transport as any).getNamespacedCommand("load_surface")).toBe(
      "plugin:api-bridge|load_surface",
    );
    expect(
      (transport as any).getNamespacedCommand("get_surface_geometry"),
    ).toBe("plugin:api-bridge|get_surface_geometry");
  });

  it("fails fast (clears the spinner + surfaces an actionable error) when a template load never settles", async () => {
    vi.useFakeTimers();
    try {
      // Backend invoke that never resolves — the offline/hung-network case.
      mockInvoke.mockImplementation(() => new Promise<never>(() => {}));
      const service = new SurfaceLoadingService();

      const resultPromise = service.loadSurfaceTemplate(
        { space: "fsaverage", geometry_type: "white", hemisphere: "left" },
        { openViewer: false, focusSurfacePanel: false },
      );

      // Spinner is up while the load is in flight.
      expect(useSurfaceStore.getState().isLoading).toBe(true);

      // Advance past the client-side timeout instead of hanging forever.
      await vi.advanceTimersByTimeAsync(31_000);
      const handle = await resultPromise;

      expect(handle).toBeNull();
      const state = useSurfaceStore.getState();
      // Safety net cleared the global spinner…
      expect(state.isLoading).toBe(false);
      // …and a clear, actionable message replaced the dead-end spinner.
      expect(state.loadError).toMatch(/timed out/i);
      expect(state.loadError).toMatch(/offline/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
