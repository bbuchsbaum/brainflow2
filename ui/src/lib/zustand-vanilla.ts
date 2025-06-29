// Re-export only the vanilla version of zustand to avoid React dependency
export { createStore } from 'zustand/vanilla';
export { subscribeWithSelector } from 'zustand/middleware';
export type { StateCreator } from 'zustand/vanilla';