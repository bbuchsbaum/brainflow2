// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	
	interface Window {
		__TAURI__?: {
			invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
			transformCallback?: (callback: Function, once?: boolean) => string;
			[key: string]: any;
		};
	}
}

export {};
