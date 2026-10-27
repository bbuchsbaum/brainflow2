import React, { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NeuroSurfaceViewer, VolumeProjectionLayer, THREE } from 'neurosurface';
import { applySceneRenderSettings, buildLayerInstance } from '../../../packages/visualization/src/surface/surfaceRuntime';
import { NeuroSurfaceCanvas } from '../../../packages/visualization/src/surface/NeuroSurfaceCanvas';
import { DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS, type SurfaceCanvasExporter, type SurfaceRenderableLayer } from '../../../packages/visualization/src/surface/types';

const sphere = new THREE.SphereGeometry(20, 32, 24);
const vertices = new Float32Array(sphere.getAttribute('position').array);
const faces = new Uint32Array(sphere.index!.array);
sphere.dispose();
const count = vertices.length / 3;
const rgba = new Float32Array(count * 4);
for (let i = 0; i < count; i++) rgba.set([0.1, 0.8, 0.2, 1], 4 * i);
const scalar = (value: number) => new Float32Array(count).fill(value);
// The affine maps sphere x coordinates to 0.25 +/- 0.0002 voxels.
// The two x voxel values are 0 and 1, so linear sampling is approximately 0.25.
const ramp = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]);


export function Harness() {
  const [mode, setMode] = useState<'scalar' | 'rgba' | 'none'>('scalar');
  const [value, setValue] = useState(0.7);
  const params = new URLSearchParams(location.search);
  const rampColormap = params.get('ramp') || 'viridis';
  const [rampMode, setRampMode] = useState<'off' | 'scalar' | 'volume' | 'zero'>(params.has('ramp') ? 'scalar' : 'off');
  const [threshold, setThreshold] = useState(false);
  const [opacity, setOpacity] = useState(1);
  // Fixed color operands are required for the tint pixel regression.
  // eslint-disable-next-line no-restricted-syntax
  const [color, setColor] = useState('#ffffff');
  const [mounted, setMounted] = useState(true);
  const [size, setSize] = useState(400);
  const [pick, setPick] = useState('none');
  const [error, setError] = useState('');
  const [exporter, setExporter] = useState<SurfaceCanvasExporter | null>(null);
  const onExporterChange = useCallback((next: SurfaceCanvasExporter | null) => setExporter(() => next), []);
  const onError = useCallback((e: unknown) => setError(String(e)), []);
  const onPick = useCallback((p: [number, number, number]) => setPick(JSON.stringify(p)), []);
  const surfaces = useMemo(() => {
    if (rampMode !== 'off') {
      // Map the sphere's world x in [-20,20] to voxel x = .25 +/- .0002.
      // The x-ramp volume should therefore match an independent constant .25
      // scalar map, while nearest-voxel sampling would select zero throughout.
      const layer: SurfaceRenderableLayer = { id: 'ramp', values: new Float32Array(count).fill(rampMode === 'zero' ? 0.01 : 0.25), colormap: rampColormap, range: [0, 1], threshold: [0, 0], opacity: 1 };
      if (rampMode === 'volume') Object.assign(layer, { volumeData: ramp.buffer, volumeDims: [2, 2, 2], affineMatrix: new Float32Array([100000, 0, 0, 0, 0, 40, 0, 0, 0, 0, 40, 0, -25000, -20, -20, 1]) });
      return [{ handle: 'ramp-sphere', geometry: { vertices, faces, hemisphere: 'left' }, layers: [layer] }];
    }
    const layers: SurfaceRenderableLayer[] = mode === 'none' ? [] : mode === 'rgba'
      ? [{ id: 'overlay', rgba, opacity }]
      : [{ id: 'overlay', values: scalar(value), colormap: 'viridis', range: [0, 1], threshold: threshold ? [0, 1] : [0, 0], opacity }];
    return [{ handle: 'sphere', geometry: { vertices, faces, hemisphere: 'left' }, layers }];
  }, [mode, value, threshold, opacity, rampMode, rampColormap]);
  const inspectRuntime = () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const viewer = new NeuroSurfaceViewer(host, 100, 100, { showControls: false, useShaders: false }, 'lateral');
    try {
      const settings = { ambientLightIntensity: 0.4, directionalLightIntensity: 0.8, fillLightIntensity: 0, lightPosition: [13, 27, 39] as [number, number, number] };
      const countLights = () => { let count = 0; viewer.scene.traverse(o => { if (o.type.endsWith('Light')) count++; }); return count; };
      const before = countLights();
      applySceneRenderSettings(viewer, settings); applySceneRenderSettings(viewer, settings);
      viewer.render();
      const layer = buildLayerInstance({ id: 'volume', kind: 'volume', opacity: 1, volumeData: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer, volumeDims: [2, 2, 2] }) as VolumeProjectionLayer;
      const texture = layer.getVolumeTexture(); texture.prepareForRenderer(viewer.renderer);
      document.querySelector('#runtime')!.textContent = JSON.stringify({ before, after: countLights(), position: viewer.directionalLight.position.toArray(), fill: viewer.fillLight.intensity, sampling: layer.getSamplingMode(), requestedFilter: texture.getFilter(), effectiveFilter: texture.getEffectiveFilter() });
      layer.dispose();
    } finally { viewer.dispose(); host.remove(); }
  };
  const exportImage = async () => {
    if (!exporter) return;
    const bytes = await exporter({ format: 'png', transparentBackground: false });
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const center = Array.from(ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data);
      let nonblack = 0; let r = 0; let g = 0; let b = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 30) { nonblack++; r += data[i]; g += data[i + 1]; b += data[i + 2]; }
      document.querySelector('#pixels')!.textContent = JSON.stringify({ width: img.width, height: img.height, center, nonblack, r: r / nonblack, g: g / nonblack, b: b / nonblack, bytes: bytes.length });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  return <><div style={{ display: 'flex', gap: 4 }}>
    {/* Fixed operands exercise base-color tinting. */}
    {/* eslint-disable-next-line no-restricted-syntax */}
    <button onClick={() => setColor(c => c === '#ffffff' ? '#ff0000' : '#ffffff')}>base color</button>
    <button onClick={() => setValue(v => v === 0.7 ? 0.15 : 0.7)}>scalar</button>
    <button onClick={() => setThreshold(v => !v)}>threshold</button>
    <button onClick={() => setOpacity(v => v === 1 ? 0.2 : 1)}>opacity</button>
    <button onClick={() => setMode('rgba')}>rgba</button><button onClick={() => setMode('none')}>unload</button>
    <button onClick={() => setMounted(v => !v)}>mount</button><button onClick={() => setSize(v => v === 400 ? 300 : 400)}>resize</button>
    <button onClick={() => setRampMode('scalar')}>ramp scalar</button><button onClick={() => setRampMode('volume')}>ramp volume</button><button onClick={() => setRampMode('zero')}>ramp zero</button>
    <button disabled={!exporter} onClick={exportImage}>export</button><button onClick={inspectRuntime}>inspect runtime</button>
  </div><div id="viewer" style={{ width: size, height: size }}>{mounted && <NeuroSurfaceCanvas surfaces={surfaces} width={size} height={size} viewpoint='lateral' projectionSettings={{ useGPUProjection: rampMode === 'volume' }} materialSettings={{ ...DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS, surfaceColor: color }} onExporterChange={onExporterChange} onError={onError} onSurfacePick={onPick} />}</div>
  <output id="runtime"/><output id="pixels"/><output id="pick">{pick}</output><output id="error">{error}</output></>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
