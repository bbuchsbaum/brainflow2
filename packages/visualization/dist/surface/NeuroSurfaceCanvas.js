import { jsx as _jsx } from "react/jsx-runtime";
import { isSurfaceCameraState } from './cameraState.js';
import { findLinkedVertex, mapPickedTriangle } from './linkedCursor.js';
import { hasRenderableGeometry, resolvePresetHemispheres, surfaceHemisphere as hemisphereOf, } from './presetHemisphere.js';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NeuroSurfaceViewer, SurfaceGeometry, MultiLayerNeuroSurface, LaplacianSmoothing, SurfaceSet, THREE, VariantSurface, normalizeCurvature, } from 'neurosurface';
import { buildRenderableLayerSpecs, isSurfaceGeometryChanged, isSurfaceVariantSwitch, planSurfaceReconciliation, } from './surfaceReconciler.js';
import { DEFAULT_NEURO_SURFACE_DISPLAY_SETTINGS, DEFAULT_NEURO_SURFACE_LIGHTING_SETTINGS, DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS, DEFAULT_NEURO_SURFACE_PROJECTION_SETTINGS, } from './types.js';
import { buildLayerInstance, applyLayerUpdate, applySurfaceRenderSettings, applySceneRenderSettings, } from './surfaceRuntime.js';
/** Fraction of the pane kept clear around the mesh by the on-screen fit. */
const VIEW_FIT_PADDING = 0.08;
/**
 * Presets aim at the origin; retain the fitted mesh center, then fit the
 * visible meshes to the pane along the preset's direction (centerCamera's own
 * distance is loose, so meshes otherwise load small). Returns false when
 * there were no visible mesh bounds to fit.
 *
 * The preset is keyed by `hemisphere` when one is known ("left_medial"):
 * surfview otherwise prefixes the bare name with the first-added surface's
 * hemisphere, so lh + rh loaded in the other order aimed at the wrong side.
 */
function setCenteredViewpoint(viewer, viewpoint, hemisphere) {
    viewer.centerCamera();
    const center = viewer.getCameraState?.().target;
    viewer.setViewpoint(hemisphere && !viewpoint.includes('_') ? `${hemisphere}_${viewpoint}` : viewpoint);
    const pose = viewer.getCameraState?.();
    if (center && pose && viewer.setCameraState) {
        viewer.setCameraState({
            ...pose,
            target: center,
            position: pose.position.map((value, axis) => value + center[axis]),
            up: viewer.camera.up.toArray(),
            zoom: viewer.camera.zoom,
        });
    }
    return viewer.fitToView ? viewer.fitToView({ padding: VIEW_FIT_PADDING }) : true;
}
/** Box centre and half-diagonal of xyz arrays (null when empty). */
function boundsOf(arrays) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const a of arrays) {
        for (let i = 0; i + 2 < a.length; i += 3) {
            for (let k = 0; k < 3; k++) {
                const v = a[i + k];
                if (v < min[k])
                    min[k] = v;
                if (v > max[k])
                    max[k] = v;
            }
        }
    }
    if (!Number.isFinite(min[0]))
        return null;
    const center = min.map((v, k) => (v + max[k]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    return radius > 0 ? { center, radius } : null;
}
/** Default length of a geometry morph (pial -> inflated), ms. */
const DEFAULT_MORPH_DURATION_MS = 600;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** A surface drawn with several embeddings (two or more variants, the drawn one present). */
function variantNamesOf(item) {
    if (!item.variants || !item.variant || !item.variants[item.variant])
        return null;
    const names = Object.keys(item.variants).filter((name) => item.variants[name].length === item.geometry.vertices.length);
    return names.length > 1 ? names : null;
}
/**
 * Bring a mounted VariantSurface's embeddings in line with `item.variants`
 * (a geometry loaded or unloaded since it was mounted). SurfaceSet keeps
 * its own copies; `sources` remembers which input each copy came from.
 */
function syncVariants(surface, item, sources) {
    const set = surface.surfaceSet;
    const wanted = item.variants ?? {};
    for (const [name, positions] of Object.entries(wanted)) {
        if (positions.length !== set.vertexCount * 3 || sources.get(name) === positions)
            continue;
        set.variants[name] = new Float32Array(positions);
        sources.set(name, positions);
    }
    for (const name of Object.keys(set.variants)) {
        if (!(name in wanted) && name !== surface.currentVariant()) {
            delete set.variants[name];
            sources.delete(name);
        }
    }
}
function applySmoothingToRenderedSurface(renderedSurface, original, smoothingValue) {
    const mesh = renderedSurface?.mesh;
    if (!mesh || !mesh.geometry)
        return;
    const threeGeometry = mesh.geometry;
    const positionAttribute = threeGeometry.getAttribute('position');
    if (!positionAttribute)
        return;
    positionAttribute.array.set(original.vertices);
    positionAttribute.needsUpdate = true;
    if (smoothingValue === 0) {
        threeGeometry.computeVertexNormals();
        threeGeometry.computeBoundingBox();
        threeGeometry.computeBoundingSphere();
        return;
    }
    const iterations = Math.ceil(smoothingValue * 5);
    const lambda = 0.3 + smoothingValue * 0.4;
    const method = smoothingValue > 0.5 ? 'taubin' : 'laplacian';
    try {
        LaplacianSmoothing.smoothGeometry(threeGeometry, iterations, lambda, method, true, -0.53);
    }
    catch (error) {
        console.error('Failed to apply smoothing:', error);
    }
}
/**
 * Grey folding underlay (D2): values normalised to about [-1, 1] (98th
 * percentile), then surfview's `brightness − clamp(c / smoothness, ±0.5) ·
 * contrast`: gyri ≈ 0.75, sulci ≈ 0.39, graded only near the fundus /
 * crown boundary (FreeSurfer-like), muted enough that data colours above
 * threshold stay the strongest thing on the mesh.
 */
/** The marker halo's radius, relative to the marker (1.5 px-ish ring at typical zoom). */
const MARKER_HALO_SCALE = 1.35;
const CURVATURE_STYLE = { brightness: 0.62, contrast: 0.5, smoothness: 0.5 };
function applyCurvature(renderedSurface, curvature, vertexCount, show) {
    const usable = !!curvature && curvature.length === vertexCount;
    if (usable) {
        renderedSurface.setCurvature(normalizeCurvature(new Float32Array(curvature)), CURVATURE_STYLE);
    }
    if (renderedSurface.getCurvatureLayer()) {
        renderedSurface.showCurvature(usable && show);
    }
}
/**
 * Medial with both hemispheres drawn hides the contralateral mesh, which
 * otherwise covers the medial wall; every other preset shows all meshes.
 * Visibility only: geometry, transforms and vertices stay untouched.
 */
function applyPresetVisibility(rendered, inputs, hidden) {
    for (const [handle, surface] of rendered) {
        const mesh = surface?.mesh;
        if (mesh)
            mesh.visible = hidden === null || hemisphereOf(inputs.get(handle)) !== hidden;
    }
}
/** The camera's screen basis in world coordinates. */
function cameraBasis(camera) {
    if (!camera?.matrixWorld?.elements)
        return null;
    camera.updateMatrixWorld?.();
    const e = camera.matrixWorld.elements;
    // Column-major: x axis (right), y axis (up), z axis (toward the viewer).
    return {
        right: [e[0], e[1], e[2]],
        up: [e[4], e[5], e[6]],
        forward: [-e[8], -e[9], -e[10]],
    };
}
function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1)
        out[i] = binary.charCodeAt(i);
    return out;
}
function removeRenderedSurface(viewer, handle, rendered) {
    try {
        viewer.removeSurface(handle);
        return;
    }
    catch {
        // Fallback for older viewer builds.
    }
    try {
        const mesh = rendered?.mesh;
        if (mesh) {
            viewer.scene?.remove(mesh);
            if (mesh.geometry)
                mesh.geometry.dispose();
            if (mesh.material)
                mesh.material.dispose();
        }
    }
    catch {
        // no-op
    }
    try {
        viewer.surfaces?.delete(handle);
    }
    catch {
        // no-op
    }
}
function captureCamera(viewer) {
    const pose = viewer?.getCameraState?.();
    const state = pose ? { ...pose, up: viewer?.camera?.up?.toArray(), zoom: viewer?.camera?.zoom ?? 1 } : null;
    return isSurfaceCameraState(state) ? state : null;
}
/**
 * Follow a geometry morph for its duration: the camera keeps the scene framed
 * as it grows or shrinks (target shifted with the scene's centre, distance /
 * zoom scaled with its size, view direction kept), and the morphing meshes'
 * normals are refreshed so the shading follows the shape (surfview
 * recomputes them only when the morph ends). Returns a cancel function.
 */
function startMorphDriver(viewer, meshes, from, to, durationMs) {
    const camera = viewer.camera;
    const pose = viewer.getCameraState?.();
    const scale = from && to ? to.radius / from.radius : 1;
    const shift = from && to ? to.center.map((v, k) => v - from.center[k]) : [0, 0, 0];
    const moveCamera = !!pose && !!viewer.setCameraState && !!camera &&
        (Math.abs(scale - 1) > 0.03 || Math.hypot(shift[0], shift[1], shift[2]) > 0.02 * (from?.radius ?? 1));
    const zoom0 = camera?.zoom ?? 1;
    const up = camera?.up?.toArray?.();
    const orthographic = !!camera?.isOrthographicCamera;
    const placeCamera = (e) => {
        if (!moveCamera || !pose)
            return;
        const k = 1 + (scale - 1) * e;
        const target = pose.target.map((v, i) => v + shift[i] * e);
        const offset = pose.position.map((v, i) => v - pose.target[i]);
        const position = target.map((v, i) => v + offset[i] * (orthographic ? 1 : k));
        viewer.setCameraState({
            ...pose,
            target,
            position,
            up: up ?? [0, 1, 0],
            zoom: orthographic ? zoom0 / k : zoom0,
        });
    };
    if (durationMs <= 0) {
        placeCamera(1);
        viewer.requestRender();
        return () => { };
    }
    let frame = 0;
    let tick = 0;
    let cancelled = false;
    const start = performance.now();
    const step = (now) => {
        if (cancelled)
            return;
        const t = Math.min(1, (now - start) / durationMs);
        placeCamera(easeInOutCubic(t));
        // Every other frame: a 160k-vertex mesh costs a few ms per refresh.
        if (t < 1 && tick++ % 2 === 0) {
            for (const surface of meshes)
                surface.mesh?.geometry?.computeVertexNormals();
        }
        viewer.requestRender();
        if (t < 1)
            frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
    };
}
const NeuroSurfaceCanvasInner = ({ surfaces, width, height, viewpoint = 'lateral', viewHemisphere, showControls = false, lightingSettings = DEFAULT_NEURO_SURFACE_LIGHTING_SETTINGS, displaySettings = DEFAULT_NEURO_SURFACE_DISPLAY_SETTINGS, materialSettings = DEFAULT_NEURO_SURFACE_MATERIAL_SETTINGS, projectionSettings = DEFAULT_NEURO_SURFACE_PROJECTION_SETTINGS, renderSignal, markerWorldPosition, cursorAnatomy, markerSnapToSurface = true, markerMaxSnapDistanceMm, markerSurfaceHandles, markerColor = '#39FF14', markerRadiusMm = 2.5, className = 'w-full h-full', style, onActivate, onContextMenu, onExporterChange, onCameraChange, initialCameraState, onCameraStateChange, viewpointNonce, onError, onWarning, onSurfacePick, morphDurationMs = DEFAULT_MORPH_DURATION_MS, }) => {
    const containerRef = useRef(null);
    const viewerRef = useRef(null);
    const renderedSurfacesRef = useRef(new Map());
    const renderedSurfaceInputsRef = useRef(new Map());
    const originalGeometryRef = useRef(new Map());
    // Per variant surface: which input array each SurfaceSet copy came from,
    // and the listener on its morph's end.
    const variantSourcesRef = useRef(new Map());
    const variantListenersRef = useRef(new Map());
    // The running morph's frame loop (camera and normals follow the shape).
    const morphDriverRef = useRef(null);
    // Bumped when a morph ends: the linked-cursor marker re-reads the mesh.
    const [geometryEpoch, setGeometryEpoch] = useState(0);
    const morphDurationRef = useRef(morphDurationMs);
    morphDurationRef.current = morphDurationMs;
    const smoothingRef = useRef(displaySettings.smoothing);
    smoothingRef.current = displaySettings.smoothing;
    const markerMeshRef = useRef(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const hasCenteredCamera = useRef(false);
    const initialCameraRef = useRef(initialCameraState);
    const lastSmoothingValue = useRef(0);
    const lastUseGPUProjectionRef = useRef(projectionSettings.useGPUProjection);
    const viewpointRef = useRef(viewpoint);
    viewpointRef.current = viewpoint;
    const onWarningRef = useRef(onWarning);
    onWarningRef.current = onWarning;
    const warn = useCallback((message) => {
        console.warn(`[NeuroSurfaceCanvas] ${message}`);
        onWarningRef.current?.(message);
    }, []);
    const showCurvatureRef = useRef(displaySettings.showCurvature !== false);
    showCurvatureRef.current = displaySettings.showCurvature !== false;
    const surfacesToRender = useMemo(() => {
        const unique = new Map();
        for (const item of surfaces) {
            if (!unique.has(item.handle)) {
                unique.set(item.handle, item);
            }
        }
        return Array.from(unique.values());
    }, [surfaces]);
    // Presets are hemisphere-relative; with lh and rh both drawn, Medial shows
    // one hemisphere and hides the other. Refs are written during render (as
    // viewpointRef above) for the effects and the exporter that read them.
    const { aim: presetHemisphere, hidden: hiddenHemisphere } = useMemo(() => resolvePresetHemispheres(surfacesToRender, viewpoint, viewHemisphere), [surfacesToRender, viewpoint, viewHemisphere]);
    const presetHemisphereRef = useRef(presetHemisphere);
    presetHemisphereRef.current = presetHemisphere;
    const hiddenHemisphereRef = useRef(hiddenHemisphere);
    hiddenHemisphereRef.current = hiddenHemisphere;
    const renderHandlesKey = useMemo(() => surfacesToRender
        .map((item) => item.handle)
        .sort()
        .join('|'), [surfacesToRender]);
    useEffect(() => {
        if (!isInitialized || !viewerRef.current?.renderer?.domElement || !onExporterChange) {
            return;
        }
        const exporter = (async ({ format, }) => {
            const viewer = viewerRef.current;
            const canvas = viewer?.renderer?.domElement;
            if (!canvas) {
                throw new Error('Surface canvas not ready for export');
            }
            if (viewer?.render) {
                viewer.render();
            }
            const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode surface image'))), mime, format === 'jpg' ? 0.92 : undefined);
            });
            const buffer = await blob.arrayBuffer();
            return new Uint8Array(buffer);
        });
        // D3: one figure pose on the live viewer, then everything restored.
        exporter.capturePose = async ({ pose, width: outW, height: outH, transparentBackground, background, showMarker = false }) => {
            const viewer = viewerRef.current;
            if (!viewer?.exportPNG || !viewer.setAnatomicalView) {
                throw new Error('Surface viewer cannot capture figure poses');
            }
            const limit = exporter.figureInfo?.().maxSide;
            if (limit && (outW > limit || outH > limit)) {
                throw new Error(`Surface pane ${Math.round(outW)} × ${Math.round(outH)} px is over this GPU's ${limit} px limit`);
            }
            const handles = [...renderedSurfacesRef.current.keys()];
            const inputs = renderedSurfaceInputsRef.current;
            const shown = handles.filter((h) => inputs.get(h)?.visible !== false);
            // The current camera is captured as drawn: a mesh the Medial preset
            // hides stays out unless the pose asks for that hemisphere by name
            // (shown for the capture, then hidden again like every other mesh).
            const presetHidden = pose.view === 'current' && (!pose.hemisphere || pose.hemisphere === 'both')
                ? hiddenHemisphereRef.current
                : null;
            const targets = shown.filter((h) => {
                const hemi = hemisphereOf(inputs.get(h));
                if (presetHidden && hemi === presetHidden)
                    return false;
                return !pose.hemisphere || pose.hemisphere === 'both' || hemi === pose.hemisphere;
            });
            if (targets.length === 0)
                throw new Error(`No ${pose.hemisphere ?? ''} surface to capture`.replace('  ', ' '));
            const cameraState = viewer.getCameraState?.();
            const interaction = viewer.isInteractionEnabled?.() ?? true;
            const visibility = new Map();
            for (const [h, surface] of renderedSurfacesRef.current) {
                const mesh = surface.mesh;
                if (!mesh)
                    continue;
                visibility.set(h, mesh.visible);
                mesh.visible = targets.includes(h);
            }
            const marker = markerMeshRef.current;
            const markerVisible = marker?.visible ?? false;
            if (marker)
                marker.visible = showMarker && markerVisible;
            // The viewer's own pick crosshair (the small "+" a click leaves on a
            // vertex) is interaction state too: not drawn into a figure (native check
            // item 10).
            const pickCrosshair = viewer.crosshair?.group;
            const pickCrosshairVisible = pickCrosshair?.visible ?? false;
            if (pickCrosshair)
                pickCrosshair.visible = showMarker && pickCrosshairVisible;
            const previousBackground = viewer.getFigureBackground?.();
            const pairId = 'bf-capture-pair';
            let paired = false;
            // Frame the pose at the PANE's aspect: the viewer is resized to the
            // print size first (exportPNG alone would reuse the on-screen framing,
            // leaving the brain small in a wider pane), then restored.
            const liveSize = { width: viewer.width, height: viewer.height, dpr: viewer.renderer?.getPixelRatio?.() ?? 1 };
            const outWidth = Math.max(1, Math.round(outW));
            const outHeight = Math.max(1, Math.round(outH));
            let resized = false;
            try {
                viewer.setInteractionEnabled?.(false);
                if (viewer.resize && liveSize.width > 0 && liveSize.height > 0) {
                    viewer.resize(outWidth, outHeight, { dpr: 1 });
                    resized = true;
                }
                const left = targets.find((h) => hemisphereOf(inputs.get(h)) === 'left');
                const right = targets.find((h) => hemisphereOf(inputs.get(h)) === 'right');
                let result;
                if (pose.view === 'current') {
                    // The user's camera: only the hemisphere filter applies.
                    result = null;
                }
                else if (pose.hemisphere === 'both' && left && right) {
                    const registered = viewer.registerBilateralSurfaceGroup?.({ id: pairId, leftSurfaceId: left, rightSurfaceId: right });
                    paired = !!registered?.ok;
                    result = paired
                        ? viewer.setAnatomicalView(pose.view, { layout: 'paired', groupId: pairId, fit: true })
                        : viewer.setAnatomicalView(pose.view, { layout: 'single', surfaceId: left, fit: true });
                }
                else {
                    result = viewer.setAnatomicalView(pose.view, { layout: 'single', surfaceId: targets[0], fit: true });
                }
                if (result && result.ok === false)
                    throw new Error(result.message ?? 'Anatomical view failed');
                // A tight fit of the shown meshes (the view's own fit is looser).
                if (pose.view !== 'current')
                    viewer.fitToView?.({ padding: 0.05 });
                const basis = cameraBasis(viewer.camera);
                const backgroundColor = background ? Number.parseInt(background.replace('#', ''), 16) : undefined;
                const dataUrl = viewer.exportPNG({
                    width: outWidth,
                    height: outHeight,
                    transparent: transparentBackground,
                    ...(backgroundColor !== undefined && !transparentBackground ? { background: backgroundColor } : {}),
                    colorbar: false,
                    scaleBar: false,
                    roiLabels: false,
                });
                const hemispheres = targets
                    .map((h) => hemisphereOf(inputs.get(h)))
                    .filter((x) => x !== null);
                return { bytes: dataUrlToBytes(dataUrl), basis, hemispheres: [...new Set(hemispheres)] };
            }
            finally {
                if (resized)
                    viewer.resize(liveSize.width, liveSize.height, { dpr: liveSize.dpr });
                if (paired)
                    viewer.unregisterBilateralSurfaceGroup?.(pairId);
                for (const [h, surface] of renderedSurfacesRef.current) {
                    const mesh = surface.mesh;
                    if (mesh && visibility.has(h))
                        mesh.visible = visibility.get(h);
                }
                if (marker)
                    marker.visible = markerVisible;
                if (pickCrosshair)
                    pickCrosshair.visible = pickCrosshairVisible;
                if (previousBackground && viewer.setFigureBackground) {
                    viewer.setFigureBackground(previousBackground.color ?? 0x000000, previousBackground.transparent ?? false);
                }
                if (cameraState !== undefined)
                    viewer.setCameraState?.(cameraState);
                viewer.setInteractionEnabled?.(interaction);
                viewer.requestRender?.();
            }
        };
        exporter.figureInfo = () => {
            const viewer = viewerRef.current;
            const inputs = renderedSurfaceInputsRef.current;
            const hemispheres = new Set();
            for (const h of renderedSurfacesRef.current.keys()) {
                const input = inputs.get(h);
                const hemi = input?.visible !== false ? hemisphereOf(input) : null;
                if (hemi)
                    hemispheres.add(hemi);
            }
            const rect = containerRef.current?.getBoundingClientRect();
            const gl = viewer?.renderer?.getContext?.();
            let maxSide = 4096;
            if (gl) {
                const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
                const renderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
                maxSide = Math.min(renderbuffer ?? maxSide, viewport ? Math.min(viewport[0], viewport[1]) : maxSide);
            }
            return {
                hemispheres: ['left', 'right'].filter((h) => hemispheres.has(h)),
                viewport: rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : { width: 640, height: 480 },
                maxSide,
            };
        };
        exporter.captureCamera = () => captureCamera(viewerRef.current);
        onExporterChange(exporter);
        return () => onExporterChange(null);
    }, [isInitialized, onExporterChange]);
    useEffect(() => {
        return () => {
            const viewer = viewerRef.current;
            if (viewer) {
                // Clear the ref first: dispose() releases the WebGL context, and the
                // context-lost listener must not report that teardown as a loss.
                viewerRef.current = null;
                viewer.dispose();
            }
            morphDriverRef.current?.();
            morphDriverRef.current = null;
            variantListenersRef.current.forEach((unsubscribe) => unsubscribe());
            variantListenersRef.current.clear();
            variantSourcesRef.current.clear();
            renderedSurfacesRef.current.clear();
            renderedSurfaceInputsRef.current.clear();
            originalGeometryRef.current.clear();
        };
    }, []);
    useEffect(() => {
        if (!containerRef.current || isInitialized || viewerRef.current)
            return;
        let pendingFrame = null;
        let cancelled = false;
        const initializeWhenReady = () => {
            if (cancelled || !containerRef.current || viewerRef.current)
                return;
            const rect = containerRef.current.getBoundingClientRect();
            const actualWidth = rect.width || width;
            const actualHeight = rect.height || height;
            if (actualWidth <= 0 || actualHeight <= 0) {
                pendingFrame = requestAnimationFrame(initializeWhenReady);
                return;
            }
            const buildViewer = (useShaders) => {
                return new NeuroSurfaceViewer(containerRef.current, actualWidth, actualHeight, {
                    showControls,
                    useShaders,
                    controlType: 'trackball',
                    headlight: false,
                }, viewpoint);
            };
            try {
                let viewer = buildViewer(false);
                if (viewer.initializationFailed) {
                    console.warn('[NeuroSurfaceCanvas] Viewer init failed (plain); retrying with shaders enabled');
                    viewer.dispose();
                    viewer = buildViewer(true);
                }
                if (viewer.initializationFailed) {
                    viewer.dispose();
                    throw new Error('Surface viewer failed to initialize (both plain and SSAO paths)');
                }
                viewerRef.current = viewer;
                setIsInitialized(true);
                if (viewer.renderer?.domElement && containerRef.current) {
                    const canvas = viewer.renderer.domElement;
                    canvas.style.position = 'absolute';
                    canvas.style.top = '0';
                    canvas.style.left = '0';
                    canvas.style.width = '100%';
                    canvas.style.height = '100%';
                    viewer.renderer.setClearColor('#000000', 1);
                }
                // A lost WebGL context draws black while orbit controls keep
                // working; say so instead of leaving a silent black pane.
                if (viewer.renderer?.domElement) {
                    const canvas = viewer.renderer.domElement;
                    canvas.addEventListener('webglcontextlost', () => {
                        // A disposed viewer (unmount, layout rebuild) loses its context on
                        // purpose; only a live one losing it is worth a warning.
                        if (viewerRef.current !== viewer)
                            return;
                        warn('WebGL context lost; the surface view stops drawing until it is restored');
                    });
                    canvas.addEventListener('webglcontextrestored', () => {
                        if (viewerRef.current !== viewer)
                            return;
                        warn('WebGL context restored');
                        viewerRef.current?.requestRender();
                    });
                }
                if (viewer.startRenderLoop) {
                    viewer.startRenderLoop();
                }
                viewer.requestRender();
            }
            catch (error) {
                console.error('Failed to initialize surface viewer:', error);
                onError?.(error);
            }
        };
        initializeWhenReady();
        return () => {
            cancelled = true;
            if (pendingFrame !== null)
                cancelAnimationFrame(pendingFrame);
        };
    }, [isInitialized, onError, showControls, viewpoint, width, height]);
    useLayoutEffect(() => {
        const viewer = viewerRef.current;
        if (viewer && width > 0 && height > 0) {
            const camera = viewer.camera;
            const prevPosition = camera ? camera.position.clone() : null;
            const prevRotation = camera ? camera.rotation.clone() : null;
            const prevZoom = camera && camera.zoom ? camera.zoom : 1;
            viewer.resize(width, height);
            if (camera && prevPosition && prevRotation) {
                camera.position.copy(prevPosition);
                camera.rotation.copy(prevRotation);
                if (camera.zoom !== undefined) {
                    camera.zoom = prevZoom;
                    camera.updateProjectionMatrix();
                }
            }
            viewer.render();
            viewer.requestRender();
        }
    }, [width, height]);
    useEffect(() => {
        hasCenteredCamera.current = false;
        lastSmoothingValue.current = 0;
    }, [renderHandlesKey]);
    useEffect(() => {
        if (!isInitialized || !viewerRef.current)
            return;
        const viewer = viewerRef.current;
        const readySurfaces = surfacesToRender.filter(hasRenderableGeometry);
        const useGPUCompositing = projectionSettings.useGPUProjection;
        const previousUseGPUProjection = lastUseGPUProjectionRef.current;
        const forgetVariantSurface = (handle) => {
            variantListenersRef.current.get(handle)?.();
            variantListenersRef.current.delete(handle);
            variantSourcesRef.current.delete(handle);
        };
        const mountRenderedSurface = (item) => {
            const existing = renderedSurfacesRef.current.get(item.handle);
            if (existing) {
                removeRenderedSurface(viewer, item.handle, existing);
            }
            forgetVariantSurface(item.handle);
            originalGeometryRef.current.set(item.handle, {
                vertices: new Float32Array(item.geometry.vertices),
                faces: new Uint32Array(item.geometry.faces),
            });
            const config = {
                baseColor: parseInt((materialSettings.surfaceColor || '#CCCCCC').replace('#', ''), 16),
                useGPUCompositing,
            };
            const variantNames = variantNamesOf(item);
            let renderedSurface;
            if (variantNames) {
                // Several embeddings of one mesh: surfview morphs between them.
                const variants = {};
                const sources = new Map();
                for (const name of variantNames) {
                    variants[name] = item.variants[name];
                    sources.set(name, item.variants[name]);
                }
                const variantSurface = new VariantSurface(new SurfaceSet({
                    faces: item.geometry.faces,
                    hemi: item.geometry.hemisphere || 'both',
                    defaultVariant: item.variant,
                    variants,
                }), config);
                variantSourcesRef.current.set(item.handle, sources);
                const handle = item.handle;
                variantListenersRef.current.set(handle, variantSurface.on('variant:changed', () => {
                    // Bounds (picking and fitting test them first) follow the new shape.
                    const meshGeometry = variantSurface.mesh?.geometry;
                    meshGeometry?.computeBoundingBox();
                    meshGeometry?.computeBoundingSphere();
                    const original = originalGeometryRef.current.get(handle);
                    if (original && smoothingRef.current > 0) {
                        applySmoothingToRenderedSurface(variantSurface, original, smoothingRef.current);
                    }
                    setGeometryEpoch((epoch) => epoch + 1);
                    viewerRef.current?.requestRender();
                }));
                renderedSurface = variantSurface;
            }
            else {
                renderedSurface = new MultiLayerNeuroSurface(new SurfaceGeometry(item.geometry.vertices, item.geometry.faces, item.geometry.hemisphere || 'both', undefined), config);
            }
            for (const layerSpec of buildRenderableLayerSpecs(item, useGPUCompositing)) {
                renderedSurface.addLayer(buildLayerInstance(layerSpec));
            }
            applySurfaceRenderSettings(renderedSurface, displaySettings, materialSettings);
            applyCurvature(renderedSurface, item.curvature, item.geometry.vertices.length / 3, showCurvatureRef.current);
            viewer.addSurface(renderedSurface, item.handle);
            // A morph passes through shapes outside any one embedding's bounds.
            if (variantNames && renderedSurface.mesh) {
                renderedSurface.mesh.frustumCulled = false;
                renderedSurface.mesh.geometry?.computeBoundingSphere();
            }
            renderedSurfacesRef.current.set(item.handle, renderedSurface);
            renderedSurfaceInputsRef.current.set(item.handle, item);
            const original = originalGeometryRef.current.get(item.handle);
            if (original) {
                applySmoothingToRenderedSurface(renderedSurface, original, displaySettings.smoothing);
            }
        };
        // Meshes switching geometry this pass, for the camera / normals loop.
        const morphing = [];
        let morphAnimated = false;
        const shapesBefore = new Map();
        for (const [handle, input] of renderedSurfaceInputsRef.current) {
            if (renderedSurfacesRef.current.get(handle)?.mesh?.visible !== false) {
                shapesBefore.set(handle, input.geometry.vertices);
            }
        }
        try {
            let changed = false;
            let structuralChange = false;
            const readyHandles = new Set(readySurfaces.map((item) => item.handle));
            for (const [handle, renderedSurface] of Array.from(renderedSurfacesRef.current.entries())) {
                if (readyHandles.has(handle)) {
                    continue;
                }
                removeRenderedSurface(viewer, handle, renderedSurface);
                forgetVariantSurface(handle);
                renderedSurfacesRef.current.delete(handle);
                renderedSurfaceInputsRef.current.delete(handle);
                originalGeometryRef.current.delete(handle);
                changed = true;
                structuralChange = true;
            }
            if (readySurfaces.length === 0) {
                lastUseGPUProjectionRef.current = useGPUCompositing;
                viewer.requestRender();
                return;
            }
            for (const item of readySurfaces) {
                const previousInput = renderedSurfaceInputsRef.current.get(item.handle);
                const renderedSurface = renderedSurfacesRef.current.get(item.handle);
                if (!previousInput ||
                    !renderedSurface ||
                    isSurfaceGeometryChanged(previousInput, item) ||
                    // A second embedding arrived for a plain mesh: remount it morphable.
                    (variantNamesOf(item) !== null) !== variantSourcesRef.current.has(item.handle)) {
                    mountRenderedSurface(item);
                    changed = true;
                    structuralChange = true;
                    continue;
                }
                const variantSources = variantSourcesRef.current.get(item.handle);
                if (variantSources) {
                    const variantSurface = renderedSurface;
                    syncVariants(variantSurface, item, variantSources);
                    if (isSurfaceVariantSwitch(previousInput, item)) {
                        // The new shape is the smoothing baseline from here on.
                        originalGeometryRef.current.set(item.handle, {
                            vertices: new Float32Array(item.geometry.vertices),
                            faces: originalGeometryRef.current.get(item.handle)?.faces ?? new Uint32Array(item.geometry.faces),
                        });
                        const duration = Math.max(0, morphDurationRef.current);
                        // surfview names the new variant only when a morph ends, and
                        // ignores a switch to the variant it names: a switch back during
                        // a morph would then be dropped. Clear the name so it runs.
                        if (item.variant === variantSurface.currentVariant()) {
                            variantSurface.currentVariantName = '';
                        }
                        const animate = duration > 0 && smoothingRef.current === 0;
                        variantSurface.setVariant(item.variant, {
                            // Smoothing re-runs on the final shape: no morph of a smoothed mesh.
                            animate,
                            duration,
                            ease: easeInOutCubic,
                        });
                        morphing.push(variantSurface);
                        morphAnimated ||= animate;
                        changed = true;
                    }
                }
                const plan = planSurfaceReconciliation(previousInput, item, {
                    previousUseGPUProjection,
                    nextUseGPUProjection: useGPUCompositing,
                });
                if (plan.requiresRebuild) {
                    mountRenderedSurface(item);
                    changed = true;
                    structuralChange = true;
                    continue;
                }
                if (plan.compositingModeChanged && renderedSurface.setCompositingMode) {
                    renderedSurface.setCompositingMode(useGPUCompositing);
                    changed = true;
                }
                for (const layerId of plan.removeLayerIds) {
                    renderedSurface.removeLayer(layerId);
                    changed = true;
                }
                for (const layerSpec of plan.addLayers) {
                    renderedSurface.addLayer(buildLayerInstance(layerSpec));
                    changed = true;
                }
                for (const layerSpec of plan.updateLayers) {
                    applyLayerUpdate(renderedSurface, layerSpec);
                    changed = true;
                }
                if (plan.orderChanged && plan.orderedLayerIds.length > 0) {
                    renderedSurface.setLayerOrder(plan.orderedLayerIds);
                    changed = true;
                }
                if (previousInput.curvature !== item.curvature) {
                    applyCurvature(renderedSurface, item.curvature, item.geometry.vertices.length / 3, showCurvatureRef.current);
                    changed = true;
                }
                renderedSurfaceInputsRef.current.set(item.handle, item);
            }
            lastUseGPUProjectionRef.current = useGPUCompositing;
            if (morphing.length > 0 && hasCenteredCamera.current) {
                const shapesAfter = [];
                for (const [handle, input] of renderedSurfaceInputsRef.current) {
                    if (renderedSurfacesRef.current.get(handle)?.mesh?.visible !== false) {
                        shapesAfter.push(input.geometry.vertices);
                    }
                }
                morphDriverRef.current?.();
                morphDriverRef.current = startMorphDriver(viewer, morphing, boundsOf([...shapesBefore.values()]), boundsOf(shapesAfter), morphAnimated ? Math.max(0, morphDurationRef.current) : 0);
            }
            // A remounted mesh starts visible; re-apply the preset's hidden side.
            if (structuralChange) {
                applyPresetVisibility(renderedSurfacesRef.current, renderedSurfaceInputsRef.current, hiddenHemisphereRef.current);
            }
            if (structuralChange && !hasCenteredCamera.current) {
                const controls = viewer.controls;
                const wasAutoRotating = controls && controls.autoRotate ? controls.autoRotate : false;
                if (!setCenteredViewpoint(viewer, viewpointRef.current, presetHemisphereRef.current)) {
                    warn(`First fit found no visible mesh bounds (${readySurfaces.length} surface(s) ready); the view may be empty`);
                }
                if (controls && controls.autoRotate !== undefined) {
                    controls.autoRotate = wasAutoRotating;
                }
                const saved = initialCameraRef.current;
                if (saved && isSurfaceCameraState(saved)) {
                    viewer.camera.up.fromArray(saved.up);
                    viewer.setCameraState?.(saved);
                    viewer.camera.zoom = saved.zoom;
                    viewer.camera.updateProjectionMatrix();
                }
                viewer.requestRender();
                hasCenteredCamera.current = true;
                requestAnimationFrame(() => {
                    if (viewerRef.current && containerRef.current) {
                        const rect = containerRef.current.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            const camera = viewerRef.current.camera;
                            const position = camera ? camera.position.clone() : null;
                            viewerRef.current.resize(rect.width, rect.height);
                            if (camera && position) {
                                camera.position.copy(position);
                                camera.updateProjectionMatrix();
                            }
                            // The first fit can run against a placeholder size; refit to
                            // the pane's real aspect unless a saved camera was restored.
                            if (!(saved && isSurfaceCameraState(saved))) {
                                viewerRef.current.fitToView?.({ padding: VIEW_FIT_PADDING });
                            }
                            viewerRef.current.requestRender();
                        }
                    }
                });
            }
            else if (changed) {
                viewer.requestRender();
            }
        }
        catch (error) {
            console.error('Failed to load surface geometry:', error);
            onError?.(error);
        }
    }, [isInitialized, surfacesToRender, projectionSettings.useGPUProjection]);
    // The preset's hide always follows the scene. The camera re-aims and refits
    // only for a preset (or one pressed again) and for Medial switching which
    // hemisphere it shows; a hemisphere arriving or leaving under Medial keeps
    // the user's camera. The fit runs after the hide so it frames the shown side.
    const appliedPresetRef = useRef(null);
    useEffect(() => {
        const applied = appliedPresetRef.current;
        appliedPresetRef.current = { viewpoint, nonce: viewpointNonce, hidden: hiddenHemisphere };
        const viewer = viewerRef.current;
        if (!viewer || renderedSurfacesRef.current.size === 0)
            return;
        applyPresetVisibility(renderedSurfacesRef.current, renderedSurfaceInputsRef.current, hiddenHemisphere);
        const refit = !applied ||
            applied.viewpoint !== viewpoint ||
            applied.nonce !== viewpointNonce ||
            (applied.hidden !== null && hiddenHemisphere !== null && applied.hidden !== hiddenHemisphere);
        if (refit && !setCenteredViewpoint(viewer, viewpoint, presetHemisphereRef.current)) {
            warn(`Preset "${viewpoint}" found no visible mesh bounds to fit`);
        }
    }, [viewpoint, viewpointNonce, hiddenHemisphere, warn]);
    // D2: the underlay toggle.
    useEffect(() => {
        if (!viewerRef.current)
            return;
        renderedSurfacesRef.current.forEach((renderedSurface, handle) => {
            const input = renderedSurfaceInputsRef.current.get(handle);
            if (renderedSurface.getCurvatureLayer()) {
                renderedSurface.showCurvature(displaySettings.showCurvature !== false && !!input?.curvature);
            }
        });
        viewerRef.current.requestRender();
    }, [isInitialized, displaySettings.showCurvature, renderHandlesKey]);
    // D5: report the camera's screen basis when it changes (orientation glyph).
    useEffect(() => {
        if (!isInitialized || (!onCameraChange && !onCameraStateChange))
            return;
        let frame = 0;
        let last = '';
        let lastState = '';
        const tick = () => {
            const basis = cameraBasis(viewerRef.current?.camera);
            if (basis) {
                const key = [...basis.right, ...basis.up].map((v) => v.toFixed(3)).join(',');
                if (key !== last) {
                    last = key;
                    onCameraChange?.(basis);
                }
            }
            if (hasCenteredCamera.current && onCameraStateChange) {
                const state = captureCamera(viewerRef.current);
                const key = JSON.stringify(state);
                if (state && key !== lastState) {
                    lastState = key;
                    onCameraStateChange(state);
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isInitialized, onCameraChange, onCameraStateChange]);
    useEffect(() => {
        if (viewerRef.current) {
            viewerRef.current.requestRender();
        }
    }, [renderSignal]);
    useEffect(() => {
        if (!viewerRef.current || renderedSurfacesRef.current.size === 0)
            return;
        const smoothingValue = displaySettings.smoothing;
        if (Math.abs(smoothingValue - lastSmoothingValue.current) < 0.01)
            return;
        renderedSurfacesRef.current.forEach((renderedSurface, handle) => {
            const original = originalGeometryRef.current.get(handle);
            if (!original)
                return;
            applySmoothingToRenderedSurface(renderedSurface, original, smoothingValue);
        });
        lastSmoothingValue.current = smoothingValue;
        viewerRef.current.requestRender();
    }, [displaySettings.smoothing, renderHandlesKey]);
    useEffect(() => {
        if (!viewerRef.current || renderedSurfacesRef.current.size === 0)
            return;
        renderedSurfacesRef.current.forEach((renderedSurface) => {
            applySurfaceRenderSettings(renderedSurface, displaySettings, materialSettings);
        });
        viewerRef.current.requestRender();
    }, [isInitialized, displaySettings, materialSettings, renderHandlesKey]);
    useEffect(() => {
        if (!viewerRef.current)
            return;
        applySceneRenderSettings(viewerRef.current, lightingSettings);
        viewerRef.current.requestRender();
    }, [isInitialized, lightingSettings]);
    // Linked cursor: a marker sphere on the surface that tracks a world position
    // (the volume crosshair), snapped to the nearest visible-surface vertex so it
    // sits on the cortex. The mesh is created once and then repositioned / toggled
    // on updates — geometry and material are only rebuilt when radius/color change
    // — to avoid per-move allocation + shader recompile churn during scrubbing.
    useEffect(() => {
        const viewer = viewerRef.current;
        if (!isInitialized || !viewer || !viewer.scene)
            return;
        // Resolve the target position (snapped to the nearest *visible* surface).
        let position = null;
        if (markerWorldPosition) {
            if (markerSnapToSurface) {
                const snapSurfaces = surfacesToRender.filter((item) => item.visible !== false);
                const nearest = findLinkedVertex(markerSurfaceHandles ? snapSurfaces.filter((surface) => markerSurfaceHandles.includes(surface.handle)) : snapSurfaces, markerWorldPosition, cursorAnatomy);
                // A crosshair nearest the hemisphere Medial hides has no marker: it
                // would draw through the shown mesh (depthTest is off on purpose).
                // Near the midline that can hide a crosshair just inside the shown
                // hemisphere; snapping it across to the shown mesh would mislead more.
                const onHiddenMesh = nearest != null &&
                    hiddenHemisphere !== null &&
                    hemisphereOf(snapSurfaces.find((item) => item.handle === nearest.handle)) === hiddenHemisphere;
                if (nearest &&
                    !onHiddenMesh &&
                    (markerMaxSnapDistanceMm == null || nearest.distanceMm <= markerMaxSnapDistanceMm)) {
                    const rendered = renderedSurfacesRef.current.get(nearest.handle);
                    const mesh = rendered?.mesh;
                    const attribute = mesh?.geometry?.getAttribute('position');
                    if (mesh && attribute) {
                        const point = new THREE.Vector3().fromBufferAttribute(attribute, nearest.index);
                        mesh.localToWorld(point);
                        position = [point.x, point.y, point.z];
                    }
                    else {
                        position = nearest.position;
                    }
                }
            }
            else {
                position = [markerWorldPosition[0], markerWorldPosition[1], markerWorldPosition[2]];
            }
        }
        if (!position) {
            // No valid target — hide the marker but keep the mesh for reuse.
            if (markerMeshRef.current && markerMeshRef.current.visible) {
                markerMeshRef.current.visible = false;
                viewer.requestRender();
            }
            return;
        }
        let mesh = markerMeshRef.current;
        if (!mesh) {
            const geometry = new THREE.SphereGeometry(markerRadiusMm, 20, 20);
            const material = new THREE.MeshStandardMaterial({
                color: markerColor,
                emissive: markerColor,
                emissiveIntensity: 0.9,
                roughness: 0.35,
                metalness: 0,
                // Draw the cursor on top of the surface so it stays visible even when
                // the corresponding point is on the far/medial side of the mesh.
                depthTest: false,
                depthWrite: false,
            });
            mesh = new THREE.Mesh(geometry, material);
            mesh.name = 'crosshairMarker';
            mesh.renderOrder = 999;
            mesh.userData.radiusMm = markerRadiusMm;
            // A dark halo like the slice crosshair's (v1 F10): a larger back-faced
            // sphere drawn just before the marker, so the green reads on any data colour.
            // Opaque on purpose: three.js draws the transparent list after the opaque one,
            // so a transparent halo would land on top of the marker whatever its renderOrder.
            const halo = new THREE.Mesh(new THREE.SphereGeometry(markerRadiusMm * MARKER_HALO_SCALE, 20, 20), new THREE.MeshBasicMaterial({ color: 0x0b0c0e, side: THREE.BackSide, depthTest: false, depthWrite: false }));
            halo.name = 'crosshairMarkerHalo';
            halo.renderOrder = 998;
            mesh.add(halo);
            viewer.scene.add(mesh);
            markerMeshRef.current = mesh;
        }
        else {
            // Rebuild geometry only when the radius actually changes; recolor in place.
            if (mesh.userData.radiusMm !== markerRadiusMm) {
                mesh.geometry.dispose();
                mesh.geometry = new THREE.SphereGeometry(markerRadiusMm, 20, 20);
                mesh.userData.radiusMm = markerRadiusMm;
                const halo = mesh.getObjectByName('crosshairMarkerHalo');
                if (halo) {
                    halo.geometry.dispose();
                    halo.geometry = new THREE.SphereGeometry(markerRadiusMm * MARKER_HALO_SCALE, 20, 20);
                }
            }
            const material = mesh.material;
            material.color?.set?.(markerColor);
            material.emissive?.set?.(markerColor);
        }
        mesh.position.set(position[0], position[1], position[2]);
        mesh.visible = true;
        viewer.requestRender();
        // markerWorldPosition is an array; depend on its components so a fresh array
        // with identical values doesn't churn. Immutable geometry and correspondence
        // inputs re-snap on visibility changes and same-size mesh replacements.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isInitialized,
        markerWorldPosition?.[0],
        markerWorldPosition?.[1],
        markerWorldPosition?.[2],
        markerSnapToSurface,
        markerMaxSnapDistanceMm,
        markerSurfaceHandles,
        markerColor,
        markerRadiusMm,
        surfacesToRender,
        cursorAnatomy,
        displaySettings.smoothing,
        hiddenHemisphere,
        geometryEpoch,
    ]);
    // Dispose the reusable marker mesh on unmount only (it is kept alive across
    // updates above). Guarded because the viewer-dispose effect may run first.
    useEffect(() => {
        return () => {
            const mesh = markerMeshRef.current;
            markerMeshRef.current = null;
            if (!mesh)
                return;
            try {
                viewerRef.current?.scene?.remove(mesh);
            }
            catch {
                // viewer may already be disposed during teardown
            }
            try {
                const halo = mesh.getObjectByName?.('crosshairMarkerHalo');
                halo?.geometry?.dispose?.();
                halo?.material?.dispose?.();
                mesh.geometry?.dispose?.();
                const material = mesh.material;
                if (Array.isArray(material)) {
                    material.forEach((m) => m?.dispose?.());
                }
                else {
                    material?.dispose?.();
                }
            }
            catch {
                // no-op
            }
        };
    }, []);
    // Reverse linked cursor: a left-click (not a drag/rotate) on a rendered
    // surface raycasts to the picked point and reports it in the surface vertex
    // frame, so a consumer can drive the volume crosshair from a surface click.
    useEffect(() => {
        const viewer = viewerRef.current;
        const canvas = viewer?.renderer?.domElement;
        if (!isInitialized || !viewer || !canvas || !onSurfacePick)
            return;
        const DRAG_THRESHOLD_PX = 5;
        const raycaster = new THREE.Raycaster();
        let downX = 0;
        let downY = 0;
        let downButton = -1;
        const onDown = (e) => {
            downX = e.clientX;
            downY = e.clientY;
            downButton = e.button;
        };
        const onUp = (e) => {
            // Only a left click that did not drag (the trackball uses drags to rotate).
            if (downButton !== 0 || e.button !== 0)
                return;
            if (Math.abs(e.clientX - downX) > DRAG_THRESHOLD_PX ||
                Math.abs(e.clientY - downY) > DRAG_THRESHOLD_PX) {
                return;
            }
            const meshes = [];
            const handles = new Map();
            for (const [handle, surface] of renderedSurfacesRef.current) {
                const mesh = surface.mesh;
                if (!mesh || mesh.visible === false || (cursorAnatomy && !cursorAnatomy.has(handle)))
                    continue;
                meshes.push(mesh);
                handles.set(mesh, handle);
            }
            if (meshes.length === 0)
                return;
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0)
                return;
            const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(ndc, viewer.camera);
            const hits = raycaster.intersectObjects(meshes, false);
            if (hits.length > 0) {
                const hit = hits[0];
                const handle = handles.get(hit.object);
                const reference = cursorAnatomy
                    ? (handle ? cursorAnatomy.get(handle) : undefined)
                    : (handle ? originalGeometryRef.current.get(handle)?.vertices : undefined);
                if (!reference || !hit.face)
                    return;
                const mesh = hit.object;
                const positions = mesh.geometry.getAttribute('position');
                const local = mesh.worldToLocal(hit.point.clone());
                const indices = [hit.face.a, hit.face.b, hit.face.c];
                const triangle = indices.map(i => [positions.getX(i), positions.getY(i), positions.getZ(i)]);
                const world = mapPickedTriangle(reference, indices, triangle, [local.x, local.y, local.z]);
                // The picked vertex (the triangle corner nearest the hit), known on any
                // mesh, inflated too: a vertex readout needs no anatomical mesh for it.
                const d2 = triangle.map(([x, y, z]) => (x - local.x) ** 2 + (y - local.y) ** 2 + (z - local.z) ** 2);
                const corner = d2.indexOf(Math.min(...d2));
                if (world)
                    onSurfacePick(world, handle ? { handle, vertex: indices[corner] } : undefined);
            }
        };
        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('mouseup', onUp);
        return () => {
            canvas.removeEventListener('mousedown', onDown);
            canvas.removeEventListener('mouseup', onUp);
        };
    }, [isInitialized, onSurfacePick, cursorAnatomy]);
    return (_jsx("div", { ref: containerRef, className: className, onPointerDown: onActivate, onMouseEnter: onActivate, onContextMenu: onContextMenu, style: {
            width: '100%',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            position: 'relative',
            display: 'block',
            overflow: 'hidden',
            ...style,
        } }));
};
export const NeuroSurfaceCanvas = React.memo(NeuroSurfaceCanvasInner);
//# sourceMappingURL=NeuroSurfaceCanvas.js.map