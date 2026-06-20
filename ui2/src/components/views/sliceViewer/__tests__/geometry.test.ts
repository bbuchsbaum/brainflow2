import { describe, expect, it } from 'vitest';
import {
  canvasPointToImagePoint,
  clientPointToWorld,
  imagePointToCanvasPoint,
  projectWorldToCanvas,
  sliceImagePointToWorld,
  worldToSliceImagePoint,
  type SliceViewerPlacement,
  type SliceViewerPlane,
} from '../index';

const plane: SliceViewerPlane = {
  origin_mm: [10, 20, 30],
  u_mm: [2, 0, 0],
  v_mm: [0, -2, 0],
  dim_px: [100, 100],
};

const placement: SliceViewerPlacement = {
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  imageWidth: 100,
  imageHeight: 50,
};

describe('slice viewer geometry', () => {
  it('maps slice image points to world coordinates', () => {
    expect(sliceImagePointToWorld(3, 4, plane)).toEqual([16, 12, 30]);
  });

  it('projects in-plane world coordinates to image points', () => {
    expect(worldToSliceImagePoint([16, 12, 30], plane)).toEqual([3, 4]);
  });

  it('rejects world coordinates outside the plane tolerance', () => {
    expect(worldToSliceImagePoint([16, 12, 32], plane, 0.25)).toBeNull();
  });

  it('maps image and canvas points through image placement', () => {
    expect(imagePointToCanvasPoint([25, 10], placement)).toEqual({
      canvasX: 60,
      canvasY: 40,
    });
    expect(canvasPointToImagePoint({ canvasX: 60, canvasY: 40 }, placement)).toEqual([25, 10]);
    expect(canvasPointToImagePoint({ canvasX: 4, canvasY: 40 }, placement)).toBeNull();
  });

  it('projects world coordinates to placed canvas coordinates', () => {
    expect(projectWorldToCanvas([60, 0, 30], plane, placement)).toEqual({
      canvasX: 60,
      canvasY: 40,
    });
  });

  it('maps client clicks through canvas scaling and placement to world coordinates', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        top: 50,
        width: 200,
        height: 100,
        right: 300,
        bottom: 150,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }),
    });

    expect(clientPointToWorld(130, 70, canvas, placement, plane)).toEqual([60, 0, 30]);
    expect(clientPointToWorld(101, 70, canvas, placement, plane)).toBeNull();
  });
});
