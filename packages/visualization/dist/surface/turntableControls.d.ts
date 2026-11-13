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
export declare const ROTATION_PER_PANE: number;
/** Arrow-key step (radians). */
export declare const ARROW_KEY_STEP: number;
interface OrbitCamera {
    position: THREE.Vector3;
    up: THREE.Vector3;
    lookAt: (target: THREE.Vector3) => void;
    updateMatrixWorld?: (force?: boolean) => void;
}
/**
 * The screen's vertical axis in world space: the camera's `up` with any
 * component along the line of sight removed.
 */
export declare function screenUp(camera: OrbitCamera, target: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3;
/**
 * Orbit `camera` about `target`: `yaw` radians about `yawAxis` (world;
 * default the current screen vertical),
 * then `pitch` radians about the camera's horizontal axis after the yaw.
 * Positive yaw turns the brain's near side to the right (the camera moves
 * left); positive pitch turns its near side down (the camera moves up).
 */
export declare function orbitCamera(camera: OrbitCamera, target: THREE.Vector3, yaw: number, pitch: number, yawAxis?: THREE.Vector3): void;
/** The arrow-key step for `key`, or null for any other key. */
export declare function arrowKeyRotation(key: string, step?: number): {
    yaw: number;
    pitch: number;
} | null;
/** The parts of surfview's viewer the turntable reads and drives. */
export interface TurntableViewer {
    camera: OrbitCamera;
    controls?: {
        target: THREE.Vector3;
        enabled?: boolean;
        staticMoving?: boolean;
        noRotate?: boolean;
    } | null;
    requestRender: () => void;
    renderer: {
        domElement: HTMLElement;
    };
}
/**
 * Configure surfview's trackball for 1:1 pan/zoom with no rotation of its
 * own, and drive rotation from pointer drags on the canvas and arrow keys on
 * `keyTarget` (the focusable pane). Returns a detach function.
 */
export declare function attachTurntable(viewer: TurntableViewer, keyTarget: HTMLElement): () => void;
export {};
//# sourceMappingURL=turntableControls.d.ts.map