/**
 * QA 2026-10-30 F14: every layout rebuild (Reset Layout, a layout switch)
 * logged "WebGL context lost; the surface view stops drawing…" for each
 * surface view, including hidden ones. Those views were being unmounted on
 * purpose: dispose() releases the context (forceContextLoss), which fires
 * `webglcontextlost`. Only a live viewer losing its context is a warning.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const viewers = vi.hoisted(() => ({ canvases: [] as HTMLCanvasElement[], disposed: 0 }));

vi.mock('neurosurface', () => {
  // Any other property is callable, settable and has further properties.
  const absorb = (): unknown =>
    new Proxy(function () {}, {
      get: (_target, key) => (key === 'then' ? undefined : absorb()),
      apply: () => absorb(),
      set: () => true,
    });
  // Absorbs every viewer call the canvas makes; dispose() loses the context
  // the way three.js' forceContextLoss does.
  class FakeViewer {
    renderer: { domElement: HTMLCanvasElement; setClearColor: () => void };
    camera = undefined;
    initializationFailed = false;
    constructor(container: HTMLElement) {
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      viewers.canvases.push(canvas);
      this.renderer = { domElement: canvas, setClearColor: () => {} };
      return new Proxy(this, {
        get(target, key) {
          if (key in target) return (target as Record<PropertyKey, unknown>)[key];
          return absorb();
        },
      });
    }
    dispose() {
      viewers.disposed += 1;
      // three.js' forceContextLoss: the browser fires the event a task later.
      const canvas = this.renderer.domElement;
      const { Event: DomEvent } = canvas.ownerDocument.defaultView!;
      setTimeout(() => canvas.dispatchEvent(new DomEvent('webglcontextlost')), 0);
    }
  }
  return {
    NeuroSurfaceViewer: FakeViewer,
    SurfaceGeometry: class {},
    MultiLayerNeuroSurface: class {},
    LaplacianSmoothing: {},
    THREE: {},
    normalizeCurvature: () => new Float32Array(),
  };
});

import { NeuroSurfaceCanvas } from '@brainflow/visualization/surface';

describe('NeuroSurfaceCanvas WebGL context loss', () => {
  it('warns when a live view loses its context, not when the view is torn down', async () => {
    const onWarning = vi.fn();
    const view = render(
      <NeuroSurfaceCanvas surfaces={[]} width={200} height={100} onWarning={onWarning} />,
    );
    await vi.waitFor(() => expect(viewers.canvases.length).toBeGreaterThan(0));
    const canvas = viewers.canvases[viewers.canvases.length - 1];

    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0][0]).toMatch(/WebGL context lost/);

    onWarning.mockClear();
    const disposedBefore = viewers.disposed;
    view.unmount();
    expect(viewers.disposed).toBe(disposedBefore + 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onWarning).not.toHaveBeenCalled();
  });
});
