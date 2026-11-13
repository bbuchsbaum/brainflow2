/**
 * SUMA-style rotation for the surface view.
 *
 * surfview's trackball keeps pan (right drag) and zoom (wheel, middle drag);
 * its own rotation is switched off and replaced by this turntable:
 *
 * - The camera follows the pointer 1:1, with no damping and no drift after
 *   release (`staticMoving`).
 * - A horizontal drag turns the brain about the screen's vertical axis as it
 *   was when the drag began; a vertical drag tilts it about the screen's
 *   current horizontal axis. The pose depends only on how far the pointer
 *   has moved, not on the path, so a drag never adds roll: returning the
 *   pointer to where it started returns the brain to where it started.
 * - Arrow keys turn the brain in fixed steps while the view has focus.
 */
import * as THREE from 'three';
/** Rotation for a drag across the pane's shorter side (radians). */
export const ROTATION_PER_PANE = Math.PI;
/** Arrow-key step (radians). */
export const ARROW_KEY_STEP = THREE.MathUtils.degToRad(15);
const eye = new THREE.Vector3();
const right = new THREE.Vector3();
const axis = new THREE.Vector3();
const turn = new THREE.Quaternion();
/**
 * The screen's vertical axis in world space: the camera's `up` with any
 * component along the line of sight removed.
 */
export function screenUp(camera, target, out = new THREE.Vector3()) {
    eye.copy(camera.position).sub(target).normalize();
    out.copy(camera.up).addScaledVector(eye, -camera.up.dot(eye));
    return out.lengthSq() > 1e-12 ? out.normalize() : out.copy(camera.up).normalize();
}
/**
 * Orbit `camera` about `target`: `yaw` radians about `yawAxis` (world;
 * default the current screen vertical),
 * then `pitch` radians about the camera's horizontal axis after the yaw.
 * Positive yaw turns the brain's near side to the right (the camera moves
 * left); positive pitch turns its near side down (the camera moves up).
 */
export function orbitCamera(camera, target, yaw, pitch, yawAxis) {
    if (yawAxis)
        axis.copy(yawAxis);
    else
        screenUp(camera, target, axis);
    eye.copy(camera.position).sub(target);
    if (eye.lengthSq() === 0)
        return;
    if (yaw !== 0 && axis.lengthSq() > 0) {
        turn.setFromAxisAngle(axis.normalize(), -yaw);
        eye.applyQuaternion(turn);
        camera.up.applyQuaternion(turn);
    }
    if (pitch !== 0) {
        // The screen's horizontal axis: up × (toward the viewer).
        right.crossVectors(camera.up, eye).normalize();
        if (right.lengthSq() > 0) {
            turn.setFromAxisAngle(right, -pitch);
            eye.applyQuaternion(turn);
            camera.up.applyQuaternion(turn);
        }
    }
    camera.up.normalize();
    camera.position.copy(target).add(eye);
    camera.lookAt(target);
    camera.updateMatrixWorld?.();
}
/** The arrow-key step for `key`, or null for any other key. */
export function arrowKeyRotation(key, step = ARROW_KEY_STEP) {
    switch (key) {
        case 'ArrowLeft':
            return { yaw: -step, pitch: 0 };
        case 'ArrowRight':
            return { yaw: step, pitch: 0 };
        case 'ArrowUp':
            return { yaw: 0, pitch: -step };
        case 'ArrowDown':
            return { yaw: 0, pitch: step };
        default:
            return null;
    }
}
/**
 * Configure surfview's trackball for 1:1 pan/zoom with no rotation of its
 * own, and drive rotation from pointer drags on the canvas and arrow keys on
 * `keyTarget` (the focusable pane). Returns a detach function.
 */
export function attachTurntable(viewer, keyTarget) {
    const canvas = viewer.renderer.domElement;
    const controls = viewer.controls;
    if (controls) {
        // Public TrackballControls fields: no inertia; rotation is ours.
        controls.staticMoving = true;
        controls.noRotate = true;
    }
    const target = () => controls?.target ?? new THREE.Vector3();
    const enabled = () => controls?.enabled !== false;
    const apply = (yaw, pitch, yawAxis) => {
        orbitCamera(viewer.camera, target(), yaw, pitch, yawAxis);
        // The next frame runs the trackball's update (which emits `change`) and
        // draws the new pose; pointer moves between frames coalesce into it.
        viewer.requestRender();
    };
    let pointerId = null;
    let lastX = 0;
    let lastY = 0;
    let yawAxis = new THREE.Vector3();
    const onPointerMove = (event) => {
        if (event.pointerId !== pointerId)
            return;
        // A lost pointerup (context menu, window blur) or interaction switched
        // off mid-drag: stop rather than rotate on hover.
        if ((event.buttons & 1) === 0 || !enabled()) {
            end();
            return;
        }
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        if (dx === 0 && dy === 0)
            return;
        const rect = canvas.getBoundingClientRect();
        const side = Math.min(rect.width, rect.height);
        if (side <= 0)
            return;
        const perPixel = ROTATION_PER_PANE / side;
        apply(dx * perPixel, dy * perPixel, yawAxis);
    };
    const end = () => {
        pointerId = null;
        canvas.ownerDocument.removeEventListener('pointermove', onPointerMove);
        canvas.ownerDocument.removeEventListener('pointerup', onPointerUp);
        canvas.ownerDocument.removeEventListener('pointercancel', onPointerUp);
    };
    function onPointerUp(event) {
        if (event.pointerId === pointerId)
            end();
    }
    const onPointerDown = (event) => {
        if (!enabled())
            return;
        if (pointerId !== null && event.pointerId !== pointerId) {
            // A second finger: the trackball's pinch zoom/pan takes over.
            end();
            return;
        }
        end();
        if (event.button !== 0 || !event.isPrimary)
            return;
        pointerId = event.pointerId;
        lastX = event.clientX;
        lastY = event.clientY;
        yawAxis = screenUp(viewer.camera, target());
        canvas.ownerDocument.addEventListener('pointermove', onPointerMove);
        canvas.ownerDocument.addEventListener('pointerup', onPointerUp);
        canvas.ownerDocument.addEventListener('pointercancel', onPointerUp);
    };
    const onKeyDown = (event) => {
        // Only keys aimed at the pane itself, not at a control inside it.
        if (event.target !== keyTarget)
            return;
        if (!enabled() || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
            return;
        const step = arrowKeyRotation(event.key);
        if (!step)
            return;
        event.preventDefault();
        event.stopPropagation();
        apply(step.yaw, step.pitch);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    keyTarget.addEventListener('keydown', onKeyDown);
    return () => {
        end();
        canvas.removeEventListener('pointerdown', onPointerDown);
        keyTarget.removeEventListener('keydown', onKeyDown);
    };
}
//# sourceMappingURL=turntableControls.js.map