import type { ViewType } from '@/types/coordinates';

type Orientation = ViewType; // 'axial' | 'sagittal' | 'coronal'

interface RenderViewPayload {
  views: Record<Orientation, { origin_mm: number[]; u_mm: number[]; v_mm: number[] }>;
  crosshair: { world_mm: number[]; visible?: boolean };
  layers: Array<{
    id: string;
    volumeId: string;
    visible: boolean;
    opacity: number;
    colormap: string;
    intensity: number[];
    threshold: number[];
    blendMode?: string;
    interpolation?: string;
  }>;
  requestedView?: {
    type: string;
    origin_mm: number[];
    u_mm: number[];
    v_mm: number[];
    width: number;
    height: number;
  };
  requestedViews?: Array<{
    type: string;
    origin_mm: number[];
    u_mm: number[];
    v_mm: number[];
    width: number;
    height: number;
  }>;
  timepoint?: number;
}

interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFixedLengthArray(arr: unknown, length: number): arr is number[] {
  return Array.isArray(arr) && arr.length === length && arr.every(isFiniteNumber);
}

function validateViewPlane(payload: any, orientation: Orientation, errors: string[]) {
  const plane = payload?.views?.[orientation];
  if (!plane || typeof plane !== 'object') {
    errors.push(`views.${orientation} missing or not an object`);
    return;
  }

  if (!isFixedLengthArray(plane.origin_mm, 3)) {
    errors.push(`views.${orientation}.origin_mm must be [f32;3]`);
  }
  if (!isFixedLengthArray(plane.u_mm, 3)) {
    errors.push(`views.${orientation}.u_mm must be [f32;3]`);
  }
  if (!isFixedLengthArray(plane.v_mm, 3)) {
    errors.push(`views.${orientation}.v_mm must be [f32;3]`);
  }
}

export function validateRenderViewPayload(payload: unknown): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['Payload must be an object'] };
  }

  const state = payload as RenderViewPayload;

  // Views
  (['axial', 'sagittal', 'coronal'] as Orientation[]).forEach((orientation) => {
    validateViewPlane(state, orientation, errors);
  });

  // Crosshair
  if (!state.crosshair || typeof state.crosshair !== 'object') {
    errors.push('crosshair missing or not an object');
  } else {
    if (!isFixedLengthArray(state.crosshair.world_mm, 3)) {
      errors.push('crosshair.world_mm must be [f32;3]');
    }
    if (state.crosshair.visible !== undefined && typeof state.crosshair.visible !== 'boolean') {
      errors.push('crosshair.visible must be boolean when provided');
    }
  }

  // Layers
  if (!Array.isArray(state.layers)) {
    errors.push('layers must be an array');
  } else {
    state.layers.forEach((layer, index) => {
      if (!layer || typeof layer !== 'object') {
        errors.push(`layers[${index}] not an object`);
        return;
      }
      if (typeof layer.id !== 'string' || !layer.id) {
        errors.push(`layers[${index}].id must be a non-empty string`);
      }
      if (typeof layer.volumeId !== 'string' || !layer.volumeId) {
        errors.push(`layers[${index}].volumeId must be a non-empty string`);
      }
      if (typeof layer.visible !== 'boolean') {
        errors.push(`layers[${index}].visible must be boolean`);
      }
      if (!isFiniteNumber(layer.opacity)) {
        errors.push(`layers[${index}].opacity must be finite number`);
      }
      if (typeof layer.colormap !== 'string' || !layer.colormap) {
        errors.push(`layers[${index}].colormap must be non-empty string`);
      }
      if (!isFixedLengthArray(layer.intensity, 2)) {
        errors.push(`layers[${index}].intensity must be [f32;2]`);
      }
      if (!isFixedLengthArray(layer.threshold, 2)) {
        errors.push(`layers[${index}].threshold must be [f32;2]`);
      }
      if (layer.blendMode !== undefined && typeof layer.blendMode !== 'string') {
        errors.push(`layers[${index}].blendMode must be string when provided`);
      }
      if (layer.interpolation !== undefined && typeof layer.interpolation !== 'string') {
        errors.push(`layers[${index}].interpolation must be string when provided`);
      }
    });
  }

  // requestedView (optional)
  if (state.requestedView) {
    const rv = state.requestedView;
    if (typeof rv.type !== 'string' || !rv.type) {
      errors.push('requestedView.type must be non-empty string');
    }
    if (!isFixedLengthArray(rv.origin_mm, 4)) {
      errors.push('requestedView.origin_mm must be [f32;4]');
    }
    if (!isFixedLengthArray(rv.u_mm, 4)) {
      errors.push('requestedView.u_mm must be [f32;4]');
    }
    if (!isFixedLengthArray(rv.v_mm, 4)) {
      errors.push('requestedView.v_mm must be [f32;4]');
    }
    if (!Number.isInteger(rv.width) || rv.width <= 0) {
      errors.push('requestedView.width must be positive integer');
    }
    if (!Number.isInteger(rv.height) || rv.height <= 0) {
      errors.push('requestedView.height must be positive integer');
    }
  }

  if (state.requestedViews !== undefined) {
    if (!Array.isArray(state.requestedViews)) {
      errors.push('requestedViews must be an array when provided');
    } else if (state.requestedViews.length === 0) {
      errors.push('requestedViews must contain at least one entry when provided');
    } else {
      state.requestedViews.forEach((rv, index) => {
        if (typeof rv !== 'object' || rv === null) {
          errors.push(`requestedViews[${index}] must be an object`);
          return;
        }
        if (typeof rv.type !== 'string' || !rv.type) {
          errors.push(`requestedViews[${index}].type must be non-empty string`);
        }
        if (!isFixedLengthArray(rv.origin_mm, 4)) {
          errors.push(`requestedViews[${index}].origin_mm must be [f32;4]`);
        }
        if (!isFixedLengthArray(rv.u_mm, 4)) {
          errors.push(`requestedViews[${index}].u_mm must be [f32;4]`);
        }
        if (!isFixedLengthArray(rv.v_mm, 4)) {
          errors.push(`requestedViews[${index}].v_mm must be [f32;4]`);
        }
        if (!Number.isInteger(rv.width) || rv.width <= 0) {
          errors.push(`requestedViews[${index}].width must be positive integer`);
        }
        if (!Number.isInteger(rv.height) || rv.height <= 0) {
          errors.push(`requestedViews[${index}].height must be positive integer`);
        }
      });
    }
  }

  // timepoint optional numeric
  if (state.timepoint !== undefined && !Number.isInteger(state.timepoint)) {
    errors.push('timepoint must be integer when provided');
  }

  return { ok: errors.length === 0, errors };
}
