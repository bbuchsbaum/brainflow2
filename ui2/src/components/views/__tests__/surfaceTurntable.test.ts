/**
 * SUMA-style surface rotation: the camera follows the pointer with no
 * inertia, a drag never adds roll, and arrow keys turn in fixed steps.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  ARROW_KEY_STEP,
  ROTATION_PER_PANE,
  arrowKeyRotation,
  attachTurntable,
  orbitCamera,
  screenUp,
} from '../../../../../packages/visualization/src/surface/turntableControls';

const origin = new THREE.Vector3();

function cameraAt(position: [number, number, number], up: [number, number, number] = [0, 1, 0]) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(...position);
  camera.up.set(...up);
  camera.lookAt(origin);
  camera.updateMatrixWorld();
  return camera;
}

/** The camera's screen axes in world space. */
function screenAxes(camera: THREE.PerspectiveCamera) {
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  return { right, up };
}

describe('orbitCamera', () => {
  it('turns about the screen vertical for a horizontal drag', () => {
    const camera = cameraAt([0, 0, 100]);
    orbitCamera(camera, origin, 0.3, 0);
    // Brain's near side moves right: the camera swings to the left.
    expect(camera.position.x).toBeCloseTo(-100 * Math.sin(0.3), 6);
    expect(camera.position.y).toBeCloseTo(0, 6);
    expect(camera.position.length()).toBeCloseTo(100, 6);
    expect(screenAxes(camera).up.y).toBeCloseTo(1, 6);
  });

  it('tilts about the screen horizontal for a vertical drag', () => {
    const camera = cameraAt([0, 0, 100]);
    const before = screenAxes(camera).right.clone();
    orbitCamera(camera, origin, 0, 0.3);
    // Near side moves down: the camera rises over the top.
    expect(camera.position.y).toBeCloseTo(100 * Math.sin(0.3), 6);
    expect(camera.position.x).toBeCloseTo(0, 6);
    expect(screenAxes(camera).right.distanceTo(before)).toBeCloseTo(0, 6);
  });

  it('adds no roll: the screen horizontal stays perpendicular to the drag-start vertical', () => {
    const camera = cameraAt([80, -30, 50], [0, 0, 1]);
    const yawAxis = screenUp(camera, origin);
    const steps: Array<[number, number]> = [
      [0.4, 0.1], [0.2, -0.5], [-0.7, 0.3], [0.1, 0.6], [0.5, -0.2],
    ];
    for (const [yaw, pitch] of steps) {
      orbitCamera(camera, origin, yaw, pitch, yawAxis);
      expect(screenAxes(camera).right.dot(yawAxis)).toBeCloseTo(0, 6);
    }
  });

  it('returns to the start pose when the pointer returns to the start', () => {
    const camera = cameraAt([60, 40, 70], [0, 0, 1]);
    const yawAxis = screenUp(camera, origin);
    const start = { position: camera.position.clone(), ...screenAxes(camera) };
    // A loop of pointer moves summing to zero (a trackball would roll here).
    const loop: Array<[number, number]> = [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]];
    for (let i = 0; i < 3; i++) for (const [yaw, pitch] of loop) orbitCamera(camera, origin, yaw, pitch, yawAxis);
    const end = screenAxes(camera);
    expect(camera.position.distanceTo(start.position)).toBeLessThan(1e-6);
    expect(end.up.distanceTo(start.up)).toBeLessThan(1e-6);
    expect(end.right.distanceTo(start.right)).toBeLessThan(1e-6);
  });

  it('orbits about a target away from the origin and keeps the distance', () => {
    const target = new THREE.Vector3(10, -5, 3);
    const camera = cameraAt([10, -5, 103]);
    orbitCamera(camera, target, 1.1, -0.4);
    expect(camera.position.distanceTo(target)).toBeCloseTo(100, 6);
  });
});

describe('arrowKeyRotation', () => {
  it('maps the arrows to fixed 15 degree steps', () => {
    expect(ARROW_KEY_STEP).toBeCloseTo(Math.PI / 12, 12);
    expect(arrowKeyRotation('ArrowLeft')).toEqual({ yaw: -ARROW_KEY_STEP, pitch: 0 });
    expect(arrowKeyRotation('ArrowRight')).toEqual({ yaw: ARROW_KEY_STEP, pitch: 0 });
    expect(arrowKeyRotation('ArrowUp')).toEqual({ yaw: 0, pitch: -ARROW_KEY_STEP });
    expect(arrowKeyRotation('ArrowDown')).toEqual({ yaw: 0, pitch: ARROW_KEY_STEP });
    expect(arrowKeyRotation('a')).toBeNull();
  });
});

function pointer(
  type: string,
  init: { x: number; y: number; id?: number; button?: number; buttons?: number; primary?: boolean },
) {
  // A move reports the left button held unless told otherwise.
  const buttons = init.buttons ?? (type === 'pointermove' ? 1 : 0);
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: init.x, clientY: init.y, button: init.button ?? 0, buttons,
  });
  Object.defineProperty(event, 'pointerId', { value: init.id ?? 1 });
  Object.defineProperty(event, 'isPrimary', { value: init.primary ?? true });
  return event;
}

function setup() {
  const camera = cameraAt([0, 0, 100]);
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  const pane = document.createElement('div');
  pane.tabIndex = 0;
  pane.appendChild(canvas);
  document.body.appendChild(pane);
  const controls = { target: new THREE.Vector3(), enabled: true, staticMoving: false, noRotate: false };
  const requestRender = vi.fn();
  const detach = attachTurntable({ camera, controls, requestRender, renderer: { domElement: canvas } }, pane);
  return { camera, canvas, pane, controls, requestRender, detach };
}

describe('attachTurntable', () => {
  it('turns off trackball inertia and its own rotation', () => {
    const { controls, detach } = setup();
    expect(controls.staticMoving).toBe(true);
    expect(controls.noRotate).toBe(true);
    detach();
  });

  it('follows a left drag 1:1 and stops when the pointer is released', () => {
    const { camera, canvas, requestRender, detach } = setup();
    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
    // 50 px across a 200 px short side: a quarter of ROTATION_PER_PANE.
    document.dispatchEvent(pointer('pointermove', { x: 150, y: 100 }));
    const yaw = (50 / 200) * ROTATION_PER_PANE;
    expect(camera.position.x).toBeCloseTo(-100 * Math.sin(yaw), 6);
    expect(requestRender).toHaveBeenCalledTimes(1);
    document.dispatchEvent(pointer('pointerup', { x: 150, y: 100 }));
    const after = camera.position.clone();
    document.dispatchEvent(pointer('pointermove', { x: 300, y: 150 }));
    expect(camera.position.distanceTo(after)).toBe(0);
    detach();
  });

  it('leaves right and middle drags to the trackball (pan, zoom)', () => {
    const { camera, canvas, detach } = setup();
    const start = camera.position.clone();
    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100, button: 2 }));
    document.dispatchEvent(pointer('pointermove', { x: 180, y: 60 }));
    expect(camera.position.distanceTo(start)).toBe(0);
    detach();
  });

  it('turns by a fixed step on an arrow key and ignores modified keys', () => {
    const { camera, pane, requestRender, detach } = setup();
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    pane.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(camera.position.x).toBeCloseTo(-100 * Math.sin(ARROW_KEY_STEP), 6);
    expect(requestRender).toHaveBeenCalledTimes(1);

    const before = camera.position.clone();
    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true, bubbles: true }));
    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(camera.position.distanceTo(before)).toBe(0);

    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(camera.position.y).toBeGreaterThan(0);
    detach();
  });

  it('ends a drag whose pointerup was lost instead of rotating on hover', () => {
    const { camera, canvas, detach } = setup();
    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
    document.dispatchEvent(pointer('pointermove', { x: 120, y: 100 }));
    const after = camera.position.clone();
    // No pointerup arrived; the button is no longer held.
    document.dispatchEvent(pointer('pointermove', { x: 200, y: 140, buttons: 0 }));
    document.dispatchEvent(pointer('pointermove', { x: 260, y: 160, buttons: 1 }));
    expect(camera.position.distanceTo(after)).toBe(0);
    // The next press starts a fresh drag.
    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
    document.dispatchEvent(pointer('pointermove', { x: 140, y: 100 }));
    expect(camera.position.distanceTo(after)).toBeGreaterThan(0);
    detach();
  });

  it('hands a second finger to the trackball and stops rotating', () => {
    const { camera, canvas, detach } = setup();
    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100, id: 1 }));
    canvas.dispatchEvent(pointer('pointerdown', { x: 160, y: 100, id: 2, primary: false }));
    const before = camera.position.clone();
    document.dispatchEvent(pointer('pointermove', { x: 150, y: 120, id: 1 }));
    expect(camera.position.distanceTo(before)).toBe(0);
    detach();
  });

  it('stops a drag when camera interaction is switched off mid-drag', () => {
    const { camera, canvas, controls, detach } = setup();
    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
    controls.enabled = false;
    const before = camera.position.clone();
    document.dispatchEvent(pointer('pointermove', { x: 160, y: 100 }));
    expect(camera.position.distanceTo(before)).toBe(0);
    detach();
  });

  it('leaves arrow keys aimed at a control inside the pane alone', () => {
    const { camera, pane, detach } = setup();
    const input = document.createElement('input');
    pane.appendChild(input);
    const key = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    input.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(camera.position.x).toBeCloseTo(0, 9);
    detach();
  });

  it('does nothing while camera interaction is disabled, and detaches cleanly', () => {
    const { camera, canvas, pane, controls, detach } = setup();
    const start = camera.position.clone();
    controls.enabled = false;
    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
    document.dispatchEvent(pointer('pointermove', { x: 160, y: 100 }));
    expect(camera.position.distanceTo(start)).toBe(0);

    controls.enabled = true;
    detach();
    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
    document.dispatchEvent(pointer('pointermove', { x: 160, y: 100 }));
    expect(camera.position.distanceTo(start)).toBe(0);
  });
});
