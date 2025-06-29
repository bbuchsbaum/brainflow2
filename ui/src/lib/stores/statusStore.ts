import { writable } from 'svelte/store';

interface StatusState {
    mouseWorldCoord: [number, number, number] | null;
    fov: number | null;
    intensity: number | null;
    crosshairWorldCoord: [number, number, number] | null;
}

function createStatusStore() {
    const { subscribe, update } = writable<StatusState>({
        mouseWorldCoord: null,
        fov: null,
        intensity: null,
        crosshairWorldCoord: null
    });

    return {
        subscribe,
        setMouseWorldCoord: (coords: [number, number, number] | null) => {
            update(state => ({ ...state, mouseWorldCoord: coords }));
        },
        setFov: (fov: number | null) => {
            update(state => ({ ...state, fov }));
        },
        setIntensity: (intensity: number | null) => {
            update(state => ({ ...state, intensity }));
        },
        setCrosshairWorldCoord: (coords: [number, number, number] | null) => {
            update(state => ({ ...state, crosshairWorldCoord: coords }));
        }
    };
}

export const statusStore = createStatusStore();