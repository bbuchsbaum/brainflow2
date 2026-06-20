import type { FrameDiagnostics } from './generated/FrameDiagnostics';
import type { FrameReadbackMode } from './generated/FrameReadbackMode';
import type { InterpolationMode } from './generated/InterpolationMode';
import type { LayerMode } from './generated/LayerMode';

export type { FrameReadbackMode };

export interface BackendTransport {
  invoke<T>(cmd: string, args?: unknown): Promise<T>;
}

export type RenderOutputFormat = 'png' | 'rgba';
export type RenderViewType = 'axial' | 'sagittal' | 'coronal';
export type FrameRenderDiagnostics = FrameDiagnostics;

export interface RenderViewDiagnostics {
  requested_view: string | null;
  format: string;
  parse_ms: number;
  service_lock_ms: number;
  target_setup_ms: number;
  layer_processing_ms: number;
  render_loop_ms: number;
  encode_ms: number;
  total_ms: number;
  visible_layer_count: number;
  output_bytes: number;
  output_dimensions: [number, number];
  warnings: string[];
  frame: FrameDiagnostics;
}

export interface RenderViewPlanePayload {
  origin_mm: [number, number, number] | number[];
  u_mm: [number, number, number] | number[];
  v_mm: [number, number, number] | number[];
}

export interface RequestedRenderViewPayload {
  type: RenderViewType | string;
  origin_mm: [number, number, number, number] | number[];
  u_mm: [number, number, number, number] | number[];
  v_mm: [number, number, number, number] | number[];
  width: number;
  height: number;
}

export interface RenderLayerOutlinePayload {
  enabled?: boolean;
  selectedLabelId?: number;
  color?: [number, number, number, number] | number[];
  thicknessPx?: number;
}

export interface RenderLayerPayload {
  id: string;
  volumeId: string;
  visible: boolean;
  opacity: number;
  colormap: string;
  intensity: [number, number] | number[];
  threshold: [number, number] | number[];
  blendMode?: string;
  interpolation?: InterpolationMode | string;
  layerMode?: LayerMode;
  outline?: RenderLayerOutlinePayload;
}

export interface RenderViewPayload {
  views: Record<RenderViewType, RenderViewPlanePayload>;
  crosshair: {
    world_mm: [number, number, number] | number[];
    visible?: boolean;
    color?: [number, number, number, number] | number[];
  };
  layers: RenderLayerPayload[];
  requestedView?: RequestedRenderViewPayload;
  requestedViews?: RequestedRenderViewPayload[];
  timepoint?: number | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface RenderViewCommandArgs {
  stateJson: string;
  format: RenderOutputFormat;
}

export interface SubmitViewCommandArgs {
  stateJson: string;
}

export interface DecodedRawRgbaFrame {
  format: 'rgba';
  width: number;
  height: number;
  rgba: Uint8Array;
  packet: Uint8Array;
}

export interface DecodedPngFrame {
  format: 'png';
  width: number | null;
  height: number | null;
  png: Uint8Array;
  packet: Uint8Array;
}

export type DecodedRenderFrame = DecodedRawRgbaFrame | DecodedPngFrame;
export type DecodedRenderViewFrame = DecodedRenderFrame & {
  viewType: RenderViewType;
  width: number;
  height: number;
};

export interface RenderViewResult {
  format: RenderOutputFormat;
  packet: Uint8Array;
  frame: DecodedRenderFrame;
}

export interface RenderViewsResult {
  format: RenderOutputFormat;
  packet: Uint8Array;
  frames: DecodedRenderViewFrame[];
}

const VIEW_TYPES: RenderViewType[] = ['axial', 'sagittal', 'coronal'];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const VIEW_CODE_TO_TYPE: Record<number, RenderViewType> = {
  0: 'axial',
  1: 'sagittal',
  2: 'coronal',
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFixedLengthNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function validateViewPlane(payload: any, orientation: RenderViewType, errors: string[]) {
  const plane = payload?.views?.[orientation];
  if (!plane || typeof plane !== 'object') {
    errors.push(`views.${orientation} missing or not an object`);
    return;
  }

  if (!isFixedLengthNumberArray(plane.origin_mm, 3)) {
    errors.push(`views.${orientation}.origin_mm must be [f32;3]`);
  }
  if (!isFixedLengthNumberArray(plane.u_mm, 3)) {
    errors.push(`views.${orientation}.u_mm must be [f32;3]`);
  }
  if (!isFixedLengthNumberArray(plane.v_mm, 3)) {
    errors.push(`views.${orientation}.v_mm must be [f32;3]`);
  }
}

function validateRequestedView(
  value: any,
  prefix: string,
  errors: string[],
) {
  if (typeof value !== 'object' || value === null) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  if (typeof value.type !== 'string' || !value.type) {
    errors.push(`${prefix}.type must be non-empty string`);
  }
  if (!isFixedLengthNumberArray(value.origin_mm, 4)) {
    errors.push(`${prefix}.origin_mm must be [f32;4]`);
  }
  if (!isFixedLengthNumberArray(value.u_mm, 4)) {
    errors.push(`${prefix}.u_mm must be [f32;4]`);
  }
  if (!isFixedLengthNumberArray(value.v_mm, 4)) {
    errors.push(`${prefix}.v_mm must be [f32;4]`);
  }
  if (!Number.isInteger(value.width) || value.width <= 0) {
    errors.push(`${prefix}.width must be positive integer`);
  }
  if (!Number.isInteger(value.height) || value.height <= 0) {
    errors.push(`${prefix}.height must be positive integer`);
  }
}

export function validateRenderViewPayload(payload: unknown): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['Payload must be an object'] };
  }

  const state = payload as RenderViewPayload;
  VIEW_TYPES.forEach((orientation) => validateViewPlane(state, orientation, errors));

  if (!state.crosshair || typeof state.crosshair !== 'object') {
    errors.push('crosshair missing or not an object');
  } else {
    if (!isFixedLengthNumberArray(state.crosshair.world_mm, 3)) {
      errors.push('crosshair.world_mm must be [f32;3]');
    }
    if (
      state.crosshair.visible !== undefined &&
      typeof state.crosshair.visible !== 'boolean'
    ) {
      errors.push('crosshair.visible must be boolean when provided');
    }
    if (
      state.crosshair.color !== undefined &&
      !isFixedLengthNumberArray(state.crosshair.color, 4)
    ) {
      errors.push('crosshair.color must be [f32;4] when provided');
    }
  }

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
      if (!isFixedLengthNumberArray(layer.intensity, 2)) {
        errors.push(`layers[${index}].intensity must be [f32;2]`);
      }
      if (!isFixedLengthNumberArray(layer.threshold, 2)) {
        errors.push(`layers[${index}].threshold must be [f32;2]`);
      }
      if (layer.blendMode !== undefined && typeof layer.blendMode !== 'string') {
        errors.push(`layers[${index}].blendMode must be string when provided`);
      }
      if (layer.interpolation !== undefined && typeof layer.interpolation !== 'string') {
        errors.push(`layers[${index}].interpolation must be string when provided`);
      }
      if (
        layer.layerMode !== undefined &&
        !['scalar', 'label', 'mask'].includes(layer.layerMode)
      ) {
        errors.push(`layers[${index}].layerMode must be scalar, label, or mask when provided`);
      }
      if (layer.outline !== undefined) {
        if (!layer.outline || typeof layer.outline !== 'object') {
          errors.push(`layers[${index}].outline must be an object when provided`);
        } else {
          if (typeof layer.outline.enabled !== 'boolean') {
            errors.push(`layers[${index}].outline.enabled must be boolean`);
          }
          if (!Number.isFinite(layer.outline.selectedLabelId)) {
            errors.push(`layers[${index}].outline.selectedLabelId must be finite number`);
          }
          if (!isFixedLengthNumberArray(layer.outline.color, 4)) {
            errors.push(`layers[${index}].outline.color must be [f32;4]`);
          }
          if (!Number.isFinite(layer.outline.thicknessPx)) {
            errors.push(`layers[${index}].outline.thicknessPx must be finite number`);
          }
        }
      }
    });
  }

  if (state.requestedView) {
    validateRequestedView(state.requestedView, 'requestedView', errors);
  }

  if (state.requestedViews !== undefined) {
    if (!Array.isArray(state.requestedViews)) {
      errors.push('requestedViews must be an array when provided');
    } else if (state.requestedViews.length === 0) {
      errors.push('requestedViews must contain at least one entry when provided');
    } else {
      state.requestedViews.forEach((view, index) => {
        validateRequestedView(view, `requestedViews[${index}]`, errors);
      });
    }
  }

  if (
    state.timepoint !== undefined &&
    state.timepoint !== null &&
    !Number.isInteger(state.timepoint)
  ) {
    errors.push('timepoint must be integer or null when provided');
  }

  return { ok: errors.length === 0, errors };
}

export function assertValidRenderViewPayload(payload: unknown): asserts payload is RenderViewPayload {
  const validation = validateRenderViewPayload(payload);
  if (!validation.ok) {
    throw new Error(`render payload validation failed: ${validation.errors.join('; ')}`);
  }
}

export function createRenderViewArgs(
  payload: RenderViewPayload,
  format: RenderOutputFormat = 'rgba',
): RenderViewCommandArgs {
  assertValidRenderViewPayload(payload);
  return {
    stateJson: JSON.stringify(payload),
    format,
  };
}

export function createSubmitViewArgs(payload: RenderViewPayload): SubmitViewCommandArgs {
  assertValidRenderViewPayload(payload);
  return {
    stateJson: JSON.stringify(payload),
  };
}

export function coerceBinaryResponse(result: unknown, context: string): Uint8Array {
  if (result instanceof Uint8Array && result.length > 0) {
    return result;
  }

  if (result instanceof ArrayBuffer && result.byteLength > 0) {
    return new Uint8Array(result);
  }

  if (ArrayBuffer.isView(result) && result.byteLength > 0) {
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  }

  if (Array.isArray(result) && result.length > 0) {
    return new Uint8Array(result);
  }

  throw new Error(`${context} returned invalid or empty result: ${typeof result}`);
}

export function encodeRawRgbaPacket(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const packet = new Uint8Array(8 + rgba.length);
  const view = new DataView(packet.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  packet.set(rgba, 8);
  return packet;
}

export function decodeRawRgbaPayload(
  rgba: Uint8Array,
  width: number,
  height: number,
): DecodedRawRgbaFrame {
  const expected = width * height * 4;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`Invalid raw RGBA dimensions: ${width}x${height}`);
  }
  if (rgba.length !== expected) {
    throw new Error(`Raw RGBA validation failed: size mismatch. Expected ${expected}, got ${rgba.length}`);
  }
  return {
    format: 'rgba',
    width,
    height,
    rgba,
    packet: encodeRawRgbaPacket(width, height, rgba),
  };
}

export function decodeRawRgbaPacket(packet: Uint8Array): DecodedRawRgbaFrame {
  if (packet.length < 8) {
    throw new Error('Raw RGBA packet is missing its width/height header');
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  return decodeRawRgbaPayload(packet.slice(8), width, height);
}

function readPngDimensions(packet: Uint8Array): [number, number] | [null, null] {
  if (packet.length < 24) {
    return [null, null];
  }

  const chunkType = String.fromCharCode(packet[12], packet[13], packet[14], packet[15]);
  if (chunkType !== 'IHDR') {
    return [null, null];
  }

  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  return [view.getUint32(16, false), view.getUint32(20, false)];
}

export function decodePngPacket(packet: Uint8Array): DecodedPngFrame {
  const isPng =
    packet.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => packet[index] === byte);

  if (!isPng) {
    throw new Error('Data is not a valid PNG stream');
  }

  const [width, height] = readPngDimensions(packet);
  return {
    format: 'png',
    width,
    height,
    png: packet,
    packet,
  };
}

export function decodeRenderViewPacket(
  packet: Uint8Array,
  format: RenderOutputFormat,
): DecodedRenderFrame {
  return format === 'rgba' ? decodeRawRgbaPacket(packet) : decodePngPacket(packet);
}

export function decodeRenderViewsPacket(
  packet: Uint8Array,
  format: RenderOutputFormat,
): DecodedRenderViewFrame[] {
  if (packet.length < 4) {
    throw new Error('render_views returned an empty payload');
  }

  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const viewCount = view.getUint32(0, true);
  let offset = 4;
  const headers: Array<{
    viewType: RenderViewType;
    width: number;
    height: number;
    length: number;
  }> = [];

  for (let index = 0; index < viewCount; index += 1) {
    if (offset + 13 > packet.length) {
      throw new Error(`render_views payload truncated before header ${index}`);
    }

    const code = packet[offset];
    offset += 1;
    const width = view.getUint32(offset, true);
    offset += 4;
    const height = view.getUint32(offset, true);
    offset += 4;
    const length = view.getUint32(offset, true);
    offset += 4;

    const viewType = VIEW_CODE_TO_TYPE[code];
    if (!viewType) {
      throw new Error(`Unknown view code returned from backend: ${code}`);
    }

    headers.push({ viewType, width, height, length });
  }

  const frames = headers.map((header) => {
    const end = offset + header.length;
    if (end > packet.length) {
      throw new Error(`render_views payload truncated for view ${header.viewType}`);
    }

    const payload = packet.slice(offset, end);
    offset = end;

    if (format === 'rgba') {
      return {
        ...decodeRawRgbaPayload(payload, header.width, header.height),
        viewType: header.viewType,
      };
    }

    return {
      ...decodePngPacket(payload),
      viewType: header.viewType,
      width: header.width,
      height: header.height,
    };
  });

  if (offset !== packet.length) {
    throw new Error(`render_views returned ${packet.length - offset} trailing bytes`);
  }

  return frames;
}

export class RenderClient {
  constructor(private readonly transport: BackendTransport) {}

  async renderView(
    payload: RenderViewPayload,
    options: { format?: RenderOutputFormat } = {},
  ): Promise<RenderViewResult> {
    const format = options.format ?? 'rgba';
    const response = await this.transport.invoke<unknown>(
      'render_view',
      createRenderViewArgs(payload, format),
    );
    const packet = coerceBinaryResponse(response, 'render_view');
    return {
      format,
      packet,
      frame: decodeRenderViewPacket(packet, format),
    };
  }

  async submitView(payload: RenderViewPayload): Promise<RenderViewDiagnostics> {
    return this.transport.invoke<RenderViewDiagnostics>(
      'submit_view',
      createSubmitViewArgs(payload),
    );
  }

  async renderViews(
    payload: RenderViewPayload,
    options: { format?: RenderOutputFormat } = {},
  ): Promise<RenderViewsResult> {
    const format = options.format ?? 'rgba';
    const response = await this.transport.invoke<unknown>(
      'render_views',
      createRenderViewArgs(payload, format),
    );
    const packet = coerceBinaryResponse(response, 'render_views');
    return {
      format,
      packet,
      frames: decodeRenderViewsPacket(packet, format),
    };
  }
}
