/**
 * Geometry families (pial / white / inflated of one hemisphere) are drawn as
 * one surfview VariantSurface: a new `variant` morphs the mounted mesh
 * instead of removing it and adding another, and the embeddings follow the
 * loaded geometries.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceRenderable } from '@brainflow/visualization/surface';

const log = vi.hoisted(() => ({
  added: [] as string[],
  removed: [] as string[],
  setVariant: [] as Array<{ name: string; animate?: boolean; duration?: number }>,
  variantSurfaces: [] as Array<{ surfaceSet: { variants: Record<string, Float32Array> } }>,
  plainSurfaces: 0,
  cameraStates: [] as Array<{ position: number[]; target: number[] }>,
  /** Fake surfview >= 3.3 (targetVariant, add/removeVariant); else 3.1/3.2. */
  upstreamAdded: [] as string[],
  /** Animated switches waiting to run their frames (weights) and settle. */
  morphs: [] as Array<(weights: number[], settle?: boolean) => void>,
}));

vi.mock('neurosurface', async () => {
  const THREE = await import('three');
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

  class FakeViewer {
    renderer: { domElement: HTMLCanvasElement; setClearColor: () => void };
    camera = new THREE.PerspectiveCamera();
    scene = new THREE.Scene();
    initializationFailed = false;
    constructor(container: HTMLElement) {
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      this.renderer = { domElement: canvas, setClearColor: () => {} };
      return withAbsorb(this);
    }
    addSurface(_surface: unknown, handle: string) {
      log.added.push(handle);
    }
    removeSurface(handle: string) {
      log.removed.push(handle);
    }
    setViewpoint() {}
    centerCamera() {}
    // Starts 100 mm from the origin; keeps whatever pose it is given.
    pose = { position: [0, 0, 100], target: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    getCameraState() {
      return { ...this.pose, position: [...this.pose.position], target: [...this.pose.target] };
    }
    setCameraState(state: { position: number[]; target: number[] }) {
      this.pose = { ...this.pose, position: [...state.position], target: [...state.target] };
      log.cameraStates.push({ position: [...state.position], target: [...state.target] });
    }
    fitToView() {
      return true;
    }
    resize() {}
    render() {}
    requestRender() {}
    startRenderLoop() {}
    dispose() {}
  }

  function meshOf(vertices: Float32Array, faces: Uint32Array) {
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    buffer.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
    return new THREE.Mesh(buffer, new THREE.MeshBasicMaterial());
  }

  class FakeSurface {
    mesh: InstanceType<typeof THREE.Mesh>;
    constructor(geometry: { vertices: Float32Array; faces: Uint32Array }) {
      log.plainSurfaces += 1;
      this.mesh = meshOf(geometry.vertices, geometry.faces);
      return withAbsorb(this);
    }
    getCurvatureLayer() {
      return null;
    }
  }

  class FakeSurfaceSet {
    faces: Uint32Array;
    variants: Record<string, Float32Array> = {};
    vertexCount: number;
    defaultVariant: string;
    constructor(config: {
      faces: Uint32Array;
      defaultVariant: string;
      variants: Record<string, Float32Array>;
    }) {
      this.faces = config.faces;
      this.defaultVariant = config.defaultVariant;
      for (const [name, positions] of Object.entries(config.variants)) {
        this.variants[name] = new Float32Array(positions);
      }
      this.vertexCount = this.variants[config.defaultVariant].length / 3;
    }
  }

  /** surfview 3.3's VariantSurface: animated switches emit frames when the test runs them. */
  class FakeVariantSurface {
    mesh: InstanceType<typeof THREE.Mesh>;
    surfaceSet: FakeSurfaceSet;
    currentVariantName: string;
    pendingVariantName: string | null = null;
    listeners = new Map<string, Array<(payload?: unknown) => void>>();
    constructor(set: FakeSurfaceSet) {
      this.surfaceSet = set;
      this.currentVariantName = set.defaultVariant;
      this.mesh = meshOf(set.variants[set.defaultVariant], set.faces);
      log.variantSurfaces.push(this);
      return withAbsorb(this);
    }
    currentVariant() {
      return this.currentVariantName;
    }
    targetVariant() {
      return this.pendingVariantName ?? this.currentVariantName;
    }
    variantNames() {
      return Object.keys(this.surfaceSet.variants);
    }
    addVariant(name: string, positions: Float32Array) {
      log.upstreamAdded.push(name);
      this.surfaceSet.variants[name] = new Float32Array(positions);
    }
    removeVariant(name: string) {
      if (name === this.currentVariantName || name === this.pendingVariantName) return false;
      if (name === this.surfaceSet.defaultVariant) return false;
      return delete this.surfaceSet.variants[name];
    }
    private emit(event: string, payload?: unknown) {
      (this.listeners.get(event) ?? []).forEach((listener) => listener(payload));
    }
    setVariant(name: string, options: { animate?: boolean; duration?: number } = {}) {
      if (name === this.targetVariant()) return;
      log.setVariant.push({ name, animate: options.animate, duration: options.duration });
      const settle = () => {
        this.pendingVariantName = null;
        this.currentVariantName = name;
        this.emit('variant:changed', { surface: this, variant: name });
      };
      if (!options.animate) {
        settle();
        return;
      }
      this.pendingVariantName = name;
      log.morphs.push((weights: number[], finish = true) => {
        for (const weight of weights) {
          this.emit('variant:animating', { surface: this, variant: name, progress: weight, weight });
        }
        if (finish) settle();
      });
    }
    on(event: string, listener: (payload?: unknown) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return () => {
        this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== listener));
      };
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
    VariantSurface: FakeVariantSurface,
    SurfaceSet: FakeSurfaceSet,
    LaplacianSmoothing: {},
    THREE,
    normalizeCurvature: () => new Float32Array(),
  };
});

import { NeuroSurfaceCanvas } from '@brainflow/visualization/surface';

const FACES = new Uint32Array([0, 1, 2]);
const PIAL = new Float32Array([-40, 0, 0, -20, 10, 0, -30, 0, 10]);
const WHITE = new Float32Array([-38, 0, 0, -22, 9, 0, -30, 0, 9]);
const INFLATED = new Float32Array([-60, 0, 0, -6, 30, 0, -30, 0, 30]);

function display(
  variant: string,
  variants: Record<string, Float32Array> = { pial: PIAL, white: WHITE, inflated: INFLATED },
): SurfaceRenderable {
  return {
    handle: 'lh',
    visible: true,
    geometry: { vertices: variants[variant], faces: FACES, hemisphere: 'left' },
    layers: [],
    variants,
    variant,
  };
}

function canvas(surface: SurfaceRenderable, morphDurationMs?: number) {
  return (
    <NeuroSurfaceCanvas
      surfaces={[surface]}
      width={200}
      height={100}
      morphDurationMs={morphDurationMs}
    />
  );
}

describe('NeuroSurfaceCanvas geometry morph', () => {
  beforeEach(() => {
    log.added = [];
    log.removed = [];
    log.setVariant = [];
    log.variantSurfaces = [];
    log.plainSurfaces = 0;
    log.cameraStates = [];
    log.upstreamAdded = [];
    log.morphs = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 100,
      top: 0,
      left: 0,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });

  it('mounts a family once and morphs between its geometries', async () => {
    const view = render(canvas(display('pial')));
    await act(async () => {});
    expect(log.added).toEqual(['lh']);
    expect(log.variantSurfaces).toHaveLength(1);
    expect(log.plainSurfaces).toBe(0);

    view.rerender(canvas(display('inflated')));
    await act(async () => {});
    view.rerender(canvas(display('white')));
    await act(async () => {});

    expect(log.added).toEqual(['lh']);
    expect(log.removed).toEqual([]);
    expect(log.setVariant.map((call) => call.name)).toEqual(['inflated', 'white']);
    expect(log.setVariant[0]).toMatchObject({ animate: true, duration: 600 });
  });

  it('switches at once with a zero morph duration', async () => {
    const view = render(canvas(display('pial'), 0));
    await act(async () => {});
    view.rerender(canvas(display('inflated'), 0));
    await act(async () => {});
    expect(log.setVariant).toEqual([{ name: 'inflated', animate: false, duration: 0 }]);
  });

  it('adds a newly loaded geometry to the mounted mesh', async () => {
    const view = render(canvas(display('pial', { pial: PIAL, white: WHITE })));
    await act(async () => {});
    view.rerender(canvas(display('pial')));
    await act(async () => {});
    expect(log.added).toEqual(['lh']);
    expect(Object.keys(log.variantSurfaces[0].surfaceSet.variants)).toEqual([
      'pial',
      'white',
      'inflated',
    ]);
    view.rerender(canvas(display('inflated')));
    await act(async () => {});
    expect(log.setVariant.map((call) => call.name)).toEqual(['inflated']);
  });

  it('draws a lone mesh as a plain surface and remounts it once it has a family', async () => {
    const lone: SurfaceRenderable = {
      handle: 'lh',
      visible: true,
      geometry: { vertices: PIAL, faces: FACES, hemisphere: 'left' },
      layers: [],
    };
    const view = render(canvas(lone));
    await act(async () => {});
    expect(log.plainSurfaces).toBe(1);
    view.rerender(canvas(display('pial')));
    await act(async () => {});
    expect(log.variantSurfaces).toHaveLength(1);
    expect(log.added).toEqual(['lh', 'lh']);
  });

  it('keeps the scene framed as it grows: camera distance scales with the shape', async () => {
    const view = render(canvas(display('pial'), 0));
    await act(async () => {});
    log.cameraStates = [];
    view.rerender(canvas(display('inflated'), 0));
    await act(async () => {});
    const last = log.cameraStates.at(-1)!;
    // The fake viewer's pose: camera 100 mm from the target.
    const distance = Math.hypot(...last.position.map((v, i) => v - last.target[i]));
    // Pial spans x -40..-20 (half-diagonal ~ 15); inflated -60..-6 (~32).
    expect(distance).toBeGreaterThan(150);
    // The target follows the scene's centre (pial x -30, inflated x -33).
    expect(last.target[0]).toBeLessThan(0);
  });

  it('adds geometries through surfview\'s addVariant', async () => {
    const view = render(canvas(display('pial', { pial: PIAL, white: WHITE })));
    await act(async () => {});
    view.rerender(canvas(display('pial')));
    await act(async () => {});
    expect(log.upstreamAdded).toEqual(['inflated']);
  });

  it('moves the camera with surfview\'s morph frames, not its own clock', async () => {
    const view = render(canvas(display('pial')));
    await act(async () => {});
    log.cameraStates = [];
    view.rerender(canvas(display('inflated')));
    await act(async () => {});
    // Nothing moves until surfview reports a frame.
    expect(log.cameraStates).toEqual([]);
    const distanceOf = (state: { position: number[]; target: number[] }) =>
      Math.hypot(...state.position.map((v, i) => v - state.target[i]));
    act(() => log.morphs[0]([0.5]));
    // One camera pose per surfview frame: the halfway frame, then the settle.
    expect(log.cameraStates).toHaveLength(2);
    const [half, settled] = log.cameraStates.map(distanceOf);
    // The fake viewer's camera starts 100 mm out; inflated is ~2x the pial scene.
    expect(half).toBeGreaterThan(100);
    expect(settled).toBeGreaterThan(half);
    expect(half).toBeCloseTo((100 + settled) / 2, 6);
  });

  it('returns the camera to where it was when a switch is reversed half-way', async () => {
    const view = render(canvas(display('pial')));
    await act(async () => {});
    log.cameraStates = [];
    view.rerender(canvas(display('inflated')));
    await act(async () => {});
    act(() => log.morphs[0]([0.5], false)); // half-way, still running
    view.rerender(canvas(display('pial')));
    await act(async () => {});
    act(() => log.morphs[1]([0.5, 1]));
    const last = log.cameraStates.at(-1)!;
    const distance = Math.hypot(...last.position.map((v, i) => v - last.target[i]));
    // The fake viewer started 100 mm out on the pial scene.
    expect(distance).toBeCloseTo(100, 6);
  });
});
