import { createStore, subscribeWithSelector } from '$lib/zustand-vanilla';

// File extension patterns for different file types
export const FILE_PATTERNS = {
	nifti: ['.nii', '.nii.gz'],
	gifti: ['.gii', '.gii.gz'],
	image: ['.png', '.jpg', '.jpeg', '.bmp'],
	data: ['.csv', '.tsv', '.txt'],
	all: [] // Empty array means all files
} as const;

export type FilePatternKey = keyof typeof FILE_PATTERNS;

export interface MountedDirectory {
	id: string;
	path: string;
	label: string; // User-friendly name for the mount
	filePatterns: string[]; // Array of file extensions to filter
	isExpanded: boolean;
}

interface MountStore {
	// State
	mounts: Map<string, MountedDirectory>;
	activeMountId: string | null;

	// Actions
	mountDirectory: (path: string, label?: string, filePatterns?: string[]) => string;
	unmountDirectory: (id: string) => void;
	setActiveMountId: (id: string | null) => void;
	toggleMountExpanded: (id: string) => void;
	updateMountPatterns: (id: string, patterns: string[]) => void;
	getMountById: (id: string) => MountedDirectory | undefined;
	getAllMounts: () => MountedDirectory[];
}

export const mountStore = createStore<MountStore>()(
	subscribeWithSelector((set, get) => ({
		mounts: new Map(),
		activeMountId: null,

		mountDirectory: (path: string, label?: string, filePatterns?: string[]) => {
			const id = `mount-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			const mount: MountedDirectory = {
				id,
				path,
				label: label || path.split('/').pop() || path,
				filePatterns: filePatterns || FILE_PATTERNS.nifti, // Default to NIfTI files
				isExpanded: true
			};

			set((state) => {
				const newMounts = new Map(state.mounts);
				newMounts.set(id, mount);
				return {
					mounts: newMounts,
					activeMountId: id // Automatically make the new mount active
				};
			});

			return id;
		},

		unmountDirectory: (id: string) => {
			set((state) => {
				const newMounts = new Map(state.mounts);
				newMounts.delete(id);
				const newActiveId =
					state.activeMountId === id
						? newMounts.size > 0
							? Array.from(newMounts.keys())[0]
							: null
						: state.activeMountId;
				return {
					mounts: newMounts,
					activeMountId: newActiveId
				};
			});
		},

		setActiveMountId: (id: string | null) => {
			set({ activeMountId: id });
		},

		toggleMountExpanded: (id: string) => {
			set((state) => {
				const mount = state.mounts.get(id);
				if (!mount) return state;

				const newMounts = new Map(state.mounts);
				newMounts.set(id, { ...mount, isExpanded: !mount.isExpanded });
				return { mounts: newMounts };
			});
		},

		updateMountPatterns: (id: string, patterns: string[]) => {
			set((state) => {
				const mount = state.mounts.get(id);
				if (!mount) return state;

				const newMounts = new Map(state.mounts);
				newMounts.set(id, { ...mount, filePatterns: patterns });
				return { mounts: newMounts };
			});
		},

		getMountById: (id: string) => {
			return get().mounts.get(id);
		},

		getAllMounts: () => {
			return Array.from(get().mounts.values());
		}
	}))
);

// Svelte-compatible hook
export function useMountStore() {
	return mountStore.getState();
}
