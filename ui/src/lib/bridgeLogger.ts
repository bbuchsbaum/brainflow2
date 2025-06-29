import { coreApi } from './api';

export interface BridgeLogEntry {
    id: string;
    timestamp: number;
    command: string;
    params: any;
    result?: any;
    error?: any;
    duration?: number;
}

class BridgeLogger {
    private logs: BridgeLogEntry[] = [];
    private enabled = false;
    private maxLogs = 100;
    private listeners: ((log: BridgeLogEntry) => void)[] = [];

    enable() {
        this.enabled = true;
        console.log('🔍 Bridge logging enabled');
    }

    disable() {
        this.enabled = false;
        console.log('🔍 Bridge logging disabled');
    }

    clear() {
        this.logs = [];
    }

    getLogs() {
        return [...this.logs];
    }

    onLog(callback: (log: BridgeLogEntry) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private addLog(entry: BridgeLogEntry) {
        if (!this.enabled) return;

        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // Notify listeners
        this.listeners.forEach(listener => listener(entry));

        // Console log with formatting
        const { command, params, result, error, duration } = entry;
        const durationStr = duration ? ` (${duration}ms)` : '';
        
        if (error) {
            console.error(`❌ ${command}${durationStr}`, { params, error });
        } else {
            console.log(`✅ ${command}${durationStr}`, { params, result });
        }
    }

    wrapApi<T extends Record<string, Function>>(api: T): T {
        const wrapped = {} as T;

        for (const [key, fn] of Object.entries(api)) {
            if (typeof fn === 'function') {
                wrapped[key as keyof T] = (async (...args: any[]) => {
                    const id = `${Date.now()}-${Math.random()}`;
                    const timestamp = Date.now();
                    const command = key;
                    const params = args;

                    try {
                        const result = await fn(...args);
                        const duration = Date.now() - timestamp;
                        
                        this.addLog({
                            id,
                            timestamp,
                            command,
                            params,
                            result,
                            duration
                        });

                        return result;
                    } catch (error) {
                        const duration = Date.now() - timestamp;
                        
                        this.addLog({
                            id,
                            timestamp,
                            command,
                            params,
                            error,
                            duration
                        });

                        throw error;
                    }
                }) as any;
            }
        }

        return wrapped;
    }
}

export const bridgeLogger = new BridgeLogger();

// Export a wrapped version of the API with logging
export const loggedCoreApi = bridgeLogger.wrapApi(coreApi);

// Helper to wrap the API conditionally
export function wrapApiWithLogging<T extends Record<string, Function>>(api: T, enable = true): T {
    if (enable) {
        bridgeLogger.enable();
        return bridgeLogger.wrapApi(api);
    }
    return api;
}