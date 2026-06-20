import { describe, expect, it } from 'vitest';
import {
  RenderClient,
  createRenderViewArgs,
  decodePngPacket,
  decodeRawRgbaPacket,
  decodeRenderViewsPacket,
  encodeRawRgbaPacket,
  validateRenderViewPayload,
  type BackendTransport,
  type RenderViewDiagnostics,
  type RenderViewPayload,
} from '@brainflow/api';

function validPayload(): RenderViewPayload {
  const plane = {
    origin_mm: [0, 0, 0] as [number, number, number],
    u_mm: [1, 0, 0] as [number, number, number],
    v_mm: [0, 1, 0] as [number, number, number],
  };

  return {
    views: {
      axial: plane,
      sagittal: plane,
      coronal: plane,
    },
    crosshair: {
      world_mm: [1, 2, 3],
      visible: true,
      color: [0, 1, 0, 0.8],
    },
    layers: [
      {
        id: 'layer-1',
        volumeId: 'volume-1',
        visible: true,
        opacity: 1,
        colormap: 'gray',
        intensity: [0, 100],
        threshold: [0, 0],
        interpolation: 'linear',
        layerMode: 'scalar',
      },
    ],
    requestedView: {
      type: 'axial',
      origin_mm: [0, 0, 0, 1],
      u_mm: [128, 0, 0, 0],
      v_mm: [0, 128, 0, 0],
      width: 128,
      height: 128,
    },
    timepoint: 4,
  };
}

function pngWithIhdr(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function rawMultiViewPacket(): Uint8Array {
  const axial = new Uint8Array(2 * 1 * 4).fill(1);
  const sagittal = new Uint8Array(1 * 2 * 4).fill(2);
  const packet = new Uint8Array(4 + 13 * 2 + axial.length + sagittal.length);
  const view = new DataView(packet.buffer);
  view.setUint32(0, 2, true);

  let offset = 4;
  packet[offset] = 0;
  offset += 1;
  view.setUint32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, 1, true);
  offset += 4;
  view.setUint32(offset, axial.length, true);
  offset += 4;

  packet[offset] = 1;
  offset += 1;
  view.setUint32(offset, 1, true);
  offset += 4;
  view.setUint32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, sagittal.length, true);
  offset += 4;

  packet.set(axial, offset);
  offset += axial.length;
  packet.set(sagittal, offset);
  return packet;
}

describe('RenderClient', () => {
  it('constructs render_view args from validated payloads', () => {
    const args = createRenderViewArgs(validPayload(), 'rgba');

    expect(args.format).toBe('rgba');
    expect(JSON.parse(args.stateJson)).toMatchObject({
      timepoint: 4,
      requestedView: {
        type: 'axial',
        width: 128,
        height: 128,
      },
    });
  });

  it('reports required-field validation errors', () => {
    const validation = validateRenderViewPayload({
      ...validPayload(),
      crosshair: { visible: true },
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain('crosshair.world_mm must be [f32;3]');
  });

  it('decodes raw RGBA packets', () => {
    const packet = encodeRawRgbaPacket(2, 1, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const frame = decodeRawRgbaPacket(packet);

    expect(frame).toMatchObject({ format: 'rgba', width: 2, height: 1 });
    expect(Array.from(frame.rgba)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('decodes PNG streams and dimensions from IHDR', () => {
    const frame = decodePngPacket(pngWithIhdr(33, 44));

    expect(frame).toMatchObject({ format: 'png', width: 33, height: 44 });
  });

  it('propagates backend render errors', async () => {
    const transport: BackendTransport = {
      async invoke() {
        throw new Error('render backend unavailable');
      },
    };

    await expect(new RenderClient(transport).renderView(validPayload())).rejects.toThrow(
      'render backend unavailable'
    );
  });

  it('returns submit_view diagnostics from the injected transport', async () => {
    const diagnostics: RenderViewDiagnostics = {
      requested_view: 'axial',
      format: 'rgba',
      parse_ms: 0,
      service_lock_ms: 0,
      target_setup_ms: 0,
      layer_processing_ms: 0,
      render_loop_ms: 1,
      encode_ms: 0,
      total_ms: 1,
      visible_layer_count: 1,
      output_bytes: 0,
      output_dimensions: [128, 128],
      warnings: [],
      frame: {
        prepare_ms: 0,
        render_ms: 1,
        readback_ms: 0,
        total_ms: 1,
        visible_layers: 1,
        updated_layer_slots: 1,
        reused_layer_state: false,
        readback_mode: 'skip',
      },
    };
    const transport: BackendTransport = {
      async invoke(cmd, args) {
        expect(cmd).toBe('submit_view');
        expect(JSON.parse((args as { stateJson: string }).stateJson).timepoint).toBe(4);
        return diagnostics as any;
      },
    };

    await expect(new RenderClient(transport).submitView(validPayload())).resolves.toBe(diagnostics);
  });

  it('decodes multi-view raw response packets', () => {
    const frames = decodeRenderViewsPacket(rawMultiViewPacket(), 'rgba');

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ viewType: 'axial', width: 2, height: 1 });
    expect(frames[1]).toMatchObject({ viewType: 'sagittal', width: 1, height: 2 });
    expect(Array.from(frames[0].rgba)).toEqual(new Array(8).fill(1));
    expect(Array.from(frames[1].rgba)).toEqual(new Array(8).fill(2));
  });
});
