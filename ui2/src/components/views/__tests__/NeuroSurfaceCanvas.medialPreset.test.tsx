/**
 * Medial preset with lh and rh both drawn: surfview keys a bare preset by the
 * first-added surface's hemisphere and hides nothing, so Medial showed the
 * other hemisphere's lateral face covering the medial wall, and the cursor
 * marker (depthTest off on purpose) drew through it. The canvas now keys the
 * preset explicitly and hides the contralateral mesh for Medial only.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuroSurfaceCanvasProps,
  SurfaceCanvasExporter,
  SurfaceRenderable,
} from '@brainflow/visualization/surface';

/** What the tests read back from the fake viewer. */
interface RecordingViewer {
  surfaces: Map<string, { mesh: { visible: boolean } }>;
  scene: { getObjectByName: (name: string) => { visible: boolean } | undefined };
  camera: { position: { set: (x: number, y: number, z: number) => void; toArray: () => number[] } };
  centerCalls: number;
  viewpointCalls: string[];
  fits: string[][];
  exportedVisible: string[];
}

const viewers = vi.hoisted(() => ({ latest: null as RecordingViewer | null }));

vi.mock('neurosurface', async () => {
  const THREE = await import('three');
  // Any other property is callable, settable and has further properties.
  const absorb = (): unknown =>
    new Proxy(function () {}, {
      get: (_target, key) => (key === 'then' ? undefined : absorb()),
      apply: () => absorb(),
      set: () => true,
    });
  const withAbsorb = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(object, key) {
        if (key in object) return (object as Record<PropertyKey, unknown>)[key];
        return absorb();
      },
    });

  // Records which preset keys the canvas asks for and which meshes each fit
  // framed; everything else is absorbed.
  class FakeViewer {
    renderer: { domElement: HTMLCanvasElement; setClearColor: () => void };
    camera = new THREE.PerspectiveCamera();
    scene = new THREE.Scene();
    surfaces = new Map<string, { mesh: InstanceType<typeof THREE.Mesh> }>();
    viewpointCalls: string[] = [];
    fits: string[][] = [];
    initializationFailed = false;
    width = 200;
    height = 100;
    constructor(container: HTMLElement) {
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      this.renderer = { domElement: canvas, setClearColor: () => {} };
      viewers.latest = this;
      return withAbsorb(this);
    }
    addSurface(surface: { mesh: InstanceType<typeof THREE.Mesh> }, handle: string) {
      this.surfaces.set(handle, surface);
      this.scene.add(surface.mesh);
    }
    removeSurface(handle: string) {
      const surface = this.surfaces.get(handle);
      if (surface) this.scene.remove(surface.mesh);
      this.surfaces.delete(handle);
    }
    setViewpoint(name: string) {
      this.viewpointCalls.push(name);
    }
    centerCalls = 0;
    centerCamera() {
      this.centerCalls += 1;
    }
    getCameraState() {
      return { position: [0, 0, 100], target: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    }
    setCameraState() {}
    fitToView() {
      const shown = [...this.surfaces].filter(([, s]) => s.mesh.visible).map(([h]) => h);
      this.fits.push(shown);
      return shown.length > 0;
    }
    exportPNG() {
      this.exportedVisible = [...this.surfaces].filter(([, s]) => s.mesh.visible).map(([h]) => h);
      return 'data:image/png;base64,AAAA';
    }
    exportedVisible: string[] = [];
    setAnatomicalView() {
      return { ok: true };
    }
    registerBilateralSurfaceGroup() {
      return { ok: true };
    }
    resize() {}
    render() {}
    requestRender() {}
    startRenderLoop() {}
    dispose() {}
  }

  class FakeSurface {
    mesh: InstanceType<typeof THREE.Mesh>;
    constructor(geometry: { vertices: Float32Array; faces: Uint32Array }) {
      const buffer = new THREE.BufferGeometry();
      buffer.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(geometry.vertices), 3),
      );
      buffer.setIndex(new THREE.BufferAttribute(new Uint32Array(geometry.faces), 1));
      this.mesh = new THREE.Mesh(buffer, new THREE.MeshBasicMaterial());
      return withAbsorb(this);
    }
    getCurvatureLayer() {
      return null;
    }
  }

  return {
    NeuroSurfaceViewer: FakeViewer,
    SurfaceGeometry: class {
      vertices: Float32Array;
      faces: Uint32Array;
      constructor(vertices: Float32Array, faces: Uint32Array) {
        this.vertices = vertices;
        this.faces = faces;
      }
    },
    MultiLayerNeuroSurface: FakeSurface,
    LaplacianSmoothing: {},
    THREE,
    normalizeCurvature: () => new Float32Array(),
  };
});

import { NeuroSurfaceCanvas } from '@brainflow/visualization/surface';

/** A small triangle at x = `x` mm (lh negative, rh positive). */
function hemi(handle: string, hemisphere: string | undefined, x: number): SurfaceRenderable {
  return {
    handle,
    geometry: {
      vertices: new Float32Array([x, 0, 0, x, 10, 0, x, 0, 10]),
      faces: new Uint32Array([0, 1, 2]),
      hemisphere,
    },
    layers: [],
  };
}

const LH = hemi('lh', 'left', -40);
const RH = hemi('rh', 'right', 40);

function canvas(props: Partial<NeuroSurfaceCanvasProps>) {
  return <NeuroSurfaceCanvas surfaces={[LH, RH]} width={200} height={100} {...props} />;
}

async function mount(props: Partial<NeuroSurfaceCanvasProps>) {
  const view = render(canvas(props));
  await vi.waitFor(() => expect(viewers.latest?.surfaces.size ?? 0).toBeGreaterThan(0));
  return view;
}

function visibility(): Record<string, boolean> {
  return Object.fromEntries(
    [...viewers.latest!.surfaces].map(([h, s]) => [h, s.mesh.visible]),
  );
}

function marker(): { visible: boolean } | undefined {
  return viewers.latest!.scene.getObjectByName('crosshairMarker');
}

/** The camera calls so far: preset keys asked for and fits run. */
function cameraCalls() {
  return {
    viewpoints: [...viewers.latest!.viewpointCalls],
    fits: viewers.latest!.fits.length,
    centers: viewers.latest!.centerCalls,
  };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

describe('NeuroSurfaceCanvas Medial preset with both hemispheres', () => {
  beforeEach(() => {
    viewers.latest = null;
  });

  it('keys the preset by hemisphere, hides rh and fits only lh', async () => {
    await mount({ viewpoint: 'medial' });
    const viewer = viewers.latest!;
    expect(viewer.viewpointCalls).toContain('left_medial');
    expect(viewer.viewpointCalls).not.toContain('medial');
    expect(visibility()).toEqual({ lh: true, rh: false });
    // Every fit since the hide frames the shown hemisphere only.
    expect(viewer.fits.length).toBeGreaterThan(0);
    for (const fit of viewer.fits) expect(fit).toEqual(['lh']);
  });

  it('switching to Lateral shows both again', async () => {
    const view = await mount({ viewpoint: 'medial' });
    view.rerender(canvas({ viewpoint: 'lateral' }));
    expect(viewers.latest!.viewpointCalls.at(-1)).toBe('left_lateral');
    expect(visibility()).toEqual({ lh: true, rh: true });
    expect(viewers.latest!.fits.at(-1)).toEqual(['lh', 'rh']);
  });

  it('gives the same result when rh was mounted first', async () => {
    await mount({ viewpoint: 'medial', surfaces: [RH, LH] });
    expect(viewers.latest!.viewpointCalls).toContain('left_medial');
    expect(viewers.latest!.viewpointCalls).not.toContain('right_medial');
    expect(visibility()).toEqual({ lh: true, rh: false });
  });

  it('shows the requested hemisphere and re-aims when it changes', async () => {
    const view = await mount({ viewpoint: 'medial', viewHemisphere: 'right' });
    expect(viewers.latest!.viewpointCalls.at(-1)).toBe('right_medial');
    expect(visibility()).toEqual({ lh: false, rh: true });

    view.rerender(canvas({ viewpoint: 'medial', viewHemisphere: 'left' }));
    expect(viewers.latest!.viewpointCalls.at(-1)).toBe('left_medial');
    expect(visibility()).toEqual({ lh: true, rh: false });
    expect(viewers.latest!.fits.at(-1)).toEqual(['lh']);
  });

  it('does not refit when the active hemisphere changes outside Medial', async () => {
    const view = await mount({ viewpoint: 'lateral', viewHemisphere: 'left' });
    const calls = viewers.latest!.viewpointCalls.length;
    view.rerender(canvas({ viewpoint: 'lateral', viewHemisphere: 'right' }));
    expect(viewers.latest!.viewpointCalls.length).toBe(calls);
    expect(visibility()).toEqual({ lh: true, rh: true });
  });

  it('never hides a single hemisphere', async () => {
    await mount({ viewpoint: 'medial', surfaces: [RH], viewHemisphere: 'left' });
    expect(viewers.latest!.viewpointCalls).toContain('right_medial');
    expect(visibility()).toEqual({ rh: true });
  });

  it('hides a remounted contralateral mesh again', async () => {
    const view = await mount({ viewpoint: 'medial' });
    const firstRh = viewers.latest!.surfaces.get('rh');
    const moved = hemi('rh', 'right', 42);
    view.rerender(canvas({ viewpoint: 'medial', surfaces: [LH, moved] }));
    expect(viewers.latest!.surfaces.get('rh')).not.toBe(firstRh);
    expect(visibility()).toEqual({ lh: true, rh: false });
  });

  it('hides the cursor marker while the crosshair is in the hidden hemisphere', async () => {
    const view = await mount({ viewpoint: 'medial', markerWorldPosition: [40, 0, 0] });
    // Never placed: the marker is not created until it has a position.
    expect(marker()).toBeUndefined();

    // Lateral shows rh: the marker sits on it.
    view.rerender(canvas({ viewpoint: 'lateral', markerWorldPosition: [40, 0, 0] }));
    expect(marker()).toBeDefined();
    expect(marker()!.visible).toBe(true);

    // Back to Medial: hidden again, and shown once the crosshair is on lh.
    view.rerender(canvas({ viewpoint: 'medial', markerWorldPosition: [40, 0, 0] }));
    expect(marker()).toBeDefined();
    expect(marker()!.visible).toBe(false);
    view.rerender(canvas({ viewpoint: 'medial', markerWorldPosition: [-40, 0, 0] }));
    expect(marker()!.visible).toBe(true);
  });

  it('a figure capture draws both hemispheres and restores the Medial hide', async () => {
    let exporter: SurfaceCanvasExporter | null = null;
    const onExporterChange = (value: SurfaceCanvasExporter | null) => {
      exporter = value;
    };
    await mount({ viewpoint: 'medial', onExporterChange });
    await vi.waitFor(() => expect(exporter).not.toBeNull());

    await act(async () => {
      await exporter!.capturePose!({
        pose: { view: 'lateral', hemisphere: 'both' },
        width: 300,
        height: 200,
        transparentBackground: false,
      });
    });
    expect(viewers.latest!.exportedVisible).toEqual(['lh', 'rh']);
    expect(visibility()).toEqual({ lh: true, rh: false });

    // The current camera is captured as drawn: rh stays out.
    await act(async () => {
      await exporter!.capturePose!({
        pose: { view: 'current' },
        width: 300,
        height: 200,
        transparentBackground: false,
      });
    });
    expect(viewers.latest!.exportedVisible).toEqual(['lh']);
    expect(visibility()).toEqual({ lh: true, rh: false });

    // The current camera of the hidden hemisphere by name: shown for the
    // capture, hidden again after.
    await act(async () => {
      await exporter!.capturePose!({
        pose: { view: 'current', hemisphere: 'right' },
        width: 300,
        height: 200,
        transparentBackground: false,
      });
    });
    expect(viewers.latest!.exportedVisible).toEqual(['rh']);
    expect(visibility()).toEqual({ lh: true, rh: false });
  });

  it('other presets with both drawn also aim at the requested hemisphere', async () => {
    const view = await mount({ viewpoint: 'lateral', viewHemisphere: 'right' });
    // Not surfview's first-added surface (lh): the active one.
    expect(viewers.latest!.viewpointCalls).toContain('right_lateral');
    expect(viewers.latest!.viewpointCalls).not.toContain('left_lateral');
    view.rerender(canvas({ viewpoint: 'dorsal', viewHemisphere: 'right' }));
    expect(viewers.latest!.viewpointCalls.at(-1)).toBe('right_dorsal');
    expect(visibility()).toEqual({ lh: true, rh: true });
  });

  it('removing the shown hemisphere under Medial shows the other one again', async () => {
    const view = await mount({ viewpoint: 'medial' });
    expect(visibility()).toEqual({ lh: true, rh: false });
    view.rerender(canvas({ viewpoint: 'medial', surfaces: [RH] }));
    expect(visibility()).toEqual({ rh: true });
    expect(viewers.latest!.viewpointCalls.at(-1)).toBe('right_medial');
    expect(viewers.latest!.fits.at(-1)).toEqual(['rh']);
  });

  it('removing the hidden hemisphere under Medial leaves the shown one', async () => {
    const view = await mount({ viewpoint: 'medial' });
    view.rerender(canvas({ viewpoint: 'medial', surfaces: [LH] }));
    expect(visibility()).toEqual({ lh: true });
  });

  it('rh becoming drawable under Medial is hidden without moving the camera', async () => {
    // rh is in the scene before its geometry is ready (same handles throughout).
    const pending: SurfaceRenderable = {
      ...RH,
      geometry: { vertices: new Float32Array(), faces: new Uint32Array(), hemisphere: 'right' },
    };
    const view = await mount({ viewpoint: 'medial', surfaces: [LH, pending] });
    expect(viewers.latest!.viewpointCalls).toContain('left_medial');
    await nextFrame();
    const before = cameraCalls();

    view.rerender(canvas({ viewpoint: 'medial', surfaces: [LH, RH] }));
    await nextFrame();
    expect(visibility()).toEqual({ lh: true, rh: false });
    expect(cameraCalls()).toEqual(before);

    // rh shown again (visible flag) under Medial: still hidden, camera kept.
    view.rerender(canvas({ viewpoint: 'medial', surfaces: [LH, { ...RH, visible: false }] }));
    view.rerender(canvas({ viewpoint: 'medial', surfaces: [LH, RH] }));
    await nextFrame();
    expect(visibility()).toEqual({ lh: true, rh: false });
    expect(cameraCalls()).toEqual(before);

    // Pressing the preset again still refits.
    view.rerender(canvas({ viewpoint: 'medial', surfaces: [LH, RH], viewpointNonce: 1 }));
    expect(viewers.latest!.viewpointCalls.length).toBe(before.viewpoints.length + 1);
  });

  it('hides nothing when a mesh names no hemisphere', async () => {
    const unnamed = hemi('mesh', undefined, 40);
    const view = await mount({ viewpoint: 'medial', surfaces: [LH, unnamed] });
    expect(visibility()).toEqual({ lh: true, mesh: true });
    expect(viewers.latest!.viewpointCalls.at(-1)).toBe('left_medial');

    // No hemisphere anywhere: the bare preset, surfview's own fallback.
    view.rerender(canvas({ viewpoint: 'medial', surfaces: [hemi('both', 'both', 0)] }));
    expect(visibility()).toEqual({ both: true });
    expect(viewers.latest!.viewpointCalls.at(-1)).toBe('medial');
  });

  it('a marker limited to the hidden mesh hides; one limited to the shown mesh stays', async () => {
    const view = await mount({ viewpoint: 'medial', markerWorldPosition: [-40, 0, 0], markerSurfaceHandles: ['rh'] });
    expect(marker()?.visible ?? false).toBe(false);

    view.rerender(canvas({ viewpoint: 'medial', markerWorldPosition: [40, 0, 0], markerSurfaceHandles: ['lh'] }));
    expect(marker()).toBeDefined();
    expect(marker()!.visible).toBe(true);
  });
  it('hiding and showing rh under Medial keeps an orbited camera (run 6 N47)', async () => {
    // The host drops an invisible surface from the scene (collectRenderSurfaces),
    // so the handle set changes: [lh, rh] -> [lh] -> [lh, rh].
    const view = await mount({ viewpoint: 'medial', surfaces: [LH, RH] });
    await nextFrame();
    // The user orbits.
    viewers.latest!.camera.position.set(12, -34, 56);
    const before = cameraCalls();

    view.rerender(canvas({ viewpoint: 'medial', surfaces: [LH] }));
    await nextFrame();
    expect(visibility()).toEqual({ lh: true });
    view.rerender(canvas({ viewpoint: 'medial', surfaces: [LH, RH] }));
    await nextFrame();

    expect(visibility()).toEqual({ lh: true, rh: false });
    // No setCenteredViewpoint (centre + preset + fit) and no fitToView.
    expect(cameraCalls()).toEqual(before);
    expect(viewers.latest!.camera.position.toArray()).toEqual([12, -34, 56]);
  });

  it('a different surface loaded into the view still gets a first fit', async () => {
    const view = await mount({ viewpoint: 'lateral', surfaces: [LH] });
    await nextFrame();
    const before = cameraCalls();

    // Every drawn mesh replaced at once.
    view.rerender(canvas({ viewpoint: 'lateral', surfaces: [hemi('other', 'left', -20)] }));
    expect(viewers.latest!.centerCalls).toBe(before.centers + 1);
    expect(viewers.latest!.fits.at(-1)).toEqual(['other']);

    // Emptied, then loaded again.
    await nextFrame();
    view.rerender(canvas({ viewpoint: 'lateral', surfaces: [] }));
    const emptied = cameraCalls();
    view.rerender(canvas({ viewpoint: 'lateral', surfaces: [RH] }));
    expect(viewers.latest!.centerCalls).toBe(emptied.centers + 1);
    expect(viewers.latest!.fits.at(-1)).toEqual(['rh']);
  });

  it('the cursor marker is depth-tested and an occluded cursor reads as a dimmed ghost', async () => {
    const THREE = await import('three');
    await mount({ viewpoint: 'lateral', markerWorldPosition: [-40, 0, 0] });
    const mesh = marker() as unknown as InstanceType<typeof THREE.Mesh>;
    expect(mesh).toBeDefined();
    const material = mesh.material as InstanceType<typeof THREE.Material>;
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);

    const halo = mesh.getObjectByName('crosshairMarkerHalo') as InstanceType<typeof THREE.Mesh>;
    expect((halo.material as InstanceType<typeof THREE.Material>).depthTest).toBe(true);

    const ghost = mesh.getObjectByName('crosshairMarkerGhost') as InstanceType<typeof THREE.Mesh>;
    expect(ghost).toBeDefined();
    expect(ghost.geometry).toBe(mesh.geometry);
    const ghostMaterial = ghost.material as InstanceType<typeof THREE.MeshBasicMaterial>;
    expect(ghostMaterial.depthTest).toBe(true);
    expect(ghostMaterial.depthFunc).toBe(THREE.GreaterDepth);
    expect(ghostMaterial.depthWrite).toBe(false);
    expect(ghostMaterial.transparent).toBe(true);
    expect(ghostMaterial.opacity).toBeCloseTo(0.25);
  });
});
