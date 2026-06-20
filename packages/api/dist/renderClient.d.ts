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
export declare function validateRenderViewPayload(payload: unknown): ValidationResult;
export declare function assertValidRenderViewPayload(payload: unknown): asserts payload is RenderViewPayload;
export declare function createRenderViewArgs(payload: RenderViewPayload, format?: RenderOutputFormat): RenderViewCommandArgs;
export declare function createSubmitViewArgs(payload: RenderViewPayload): SubmitViewCommandArgs;
export declare function coerceBinaryResponse(result: unknown, context: string): Uint8Array;
export declare function encodeRawRgbaPacket(width: number, height: number, rgba: Uint8Array): Uint8Array;
export declare function decodeRawRgbaPayload(rgba: Uint8Array, width: number, height: number): DecodedRawRgbaFrame;
export declare function decodeRawRgbaPacket(packet: Uint8Array): DecodedRawRgbaFrame;
export declare function decodePngPacket(packet: Uint8Array): DecodedPngFrame;
export declare function decodeRenderViewPacket(packet: Uint8Array, format: RenderOutputFormat): DecodedRenderFrame;
export declare function decodeRenderViewsPacket(packet: Uint8Array, format: RenderOutputFormat): DecodedRenderViewFrame[];
export declare class RenderClient {
    private readonly transport;
    constructor(transport: BackendTransport);
    renderView(payload: RenderViewPayload, options?: {
        format?: RenderOutputFormat;
    }): Promise<RenderViewResult>;
    submitView(payload: RenderViewPayload): Promise<RenderViewDiagnostics>;
    renderViews(payload: RenderViewPayload, options?: {
        format?: RenderOutputFormat;
    }): Promise<RenderViewsResult>;
}
