/**
 * Shared display-layer DTO used by UI and render adapters.
 * Supports both volume and surface overlays to enable control reuse.
 */
export type DisplayLayerType = 'scalar' | 'rgba' | 'label' | 'outline';

export type BlendMode = 'normal' | 'additive' | 'multiply';

export interface DisplayLabelDef {
  id: number;
  color: string | number;
  name?: string;
}

export interface DisplayLayer {
  id: string;
  name?: string;
  type: DisplayLayerType;
  visible?: boolean;
  opacity?: number; // 0–1
  blendMode?: BlendMode;
  order?: number;

  // Scalar / RGBA
  intensity?: [number, number];
  threshold?: [number, number];
  colormap?: string;
  rgbaData?: Float32Array | number[];

  // Labels / outlines
  labels?: Uint32Array | Int32Array | number[];
  labelDefs?: DisplayLabelDef[];
  defaultLabelColor?: string | number;
  roiLabels?: Uint32Array | Int32Array | number[];
  roiSubset?: number[] | null;
  outline?: boolean;
  outlineColor?: string | number;
  outlineWidth?: number;
  halo?: boolean;
  haloColor?: string | number;
  haloWidth?: number;
}
