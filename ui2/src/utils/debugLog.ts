const DEBUG = import.meta.env.DEV && localStorage.getItem('brainflow2-debug-stores') === 'true';

export function storeLog(store: string, ...args: any[]) {
  if (DEBUG) console.log(`[${store}]`, ...args);
}

export function storeWarn(store: string, ...args: any[]) {
  if (DEBUG) console.warn(`[${store}]`, ...args);
}

export function storeError(store: string, ...args: any[]) {
  if (DEBUG) console.error(`[${store}]`, ...args);
}

export function storeTrace(store: string, ...args: any[]) {
  if (DEBUG) console.trace(`[${store}]`, ...args);
}
