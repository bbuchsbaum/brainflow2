import { writable } from 'svelte/store';
import { type Event as TauriEvent, listen } from '@tauri-apps/api/event';

export interface LogEntry {
  timestamp: string; // ISO format usually from tracing
  level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string; // Main message from span/event
  target?: string; // Rust module path
  file?: string;
  line?: number;
  data?: Record<string, unknown>; // Fields from the span/event
  request_id?: string; // Correlation ID if present
}

// --- Define expected structure from backend log events ---
interface RawLogPayload {
    level?: string | number;       // Can be string (TRACE) or number (1)
    message?: string;           // Main message (or use 'msg')
    msg?: string;               // Alternative field for message
    timestamp?: string;         // ISO string (or use 'time')
    time?: string;              // Alternative field for timestamp
    target?: string;
    file?: string;
    line?: number;
    fields?: Record<string, unknown> & { request_id?: string }; // Structured fields, potentially including request_id
    payload?: Record<string, unknown>; // Alternative field for generic payload
    // Add other potential fields if known
}

// Store options
const MAX_LOG_ENTRIES = 500;

// Writable store for log entries
export const logEntries = writable<LogEntry[]>([]);

// Function to parse and add log entries
function addLogEntry(rawPayload: RawLogPayload) {
    // Basic validation and type mapping
    const levelMap: Record<string | number, LogEntry['level']> = {
        // Map numeric levels from tauri-plugin-log or string levels from tracing
        TRACE: 'TRACE', 1: 'TRACE', 
        DEBUG: 'DEBUG', 2: 'DEBUG',
        INFO: 'INFO', 3: 'INFO', 
        WARN: 'WARN', 4: 'WARN',
        ERROR: 'ERROR', 5: 'ERROR',
    };
    // Use rawPayload.level if string, or map number if needed
    const rawLevel = rawPayload.level;
    const level = (rawLevel !== undefined && levelMap[rawLevel]) ? levelMap[rawLevel] : 'INFO'; // Default to INFO

    const entry: LogEntry = {
        timestamp: rawPayload.timestamp || rawPayload.time || new Date().toISOString(), // Check for 'time' field too
        level: level,
        message: rawPayload.message || rawPayload.msg || 'Unknown log message', // Check for 'msg' field too
        target: rawPayload.target,
        file: rawPayload.file,
        line: rawPayload.line,
        // tracing sends fields in `fields`, tauri-plugin-log might use `payload` directly
        data: rawPayload.fields || rawPayload.payload || {}, 
        request_id: rawPayload.fields?.request_id // Extract correlation ID if available in fields
    };

    logEntries.update(currentLogs => {
        const newLogs = [...currentLogs, entry];
        // Limit the number of entries stored
        return newLogs.slice(Math.max(newLogs.length - MAX_LOG_ENTRIES, 0));
    });
}

// Listen for log events from the Rust backend via tauri-plugin-log
// The event name might depend on the tauri-plugin-log version and config.
// Common events: 'log://log', 'plugin:log|log'
const LOG_EVENT_NAME = 'log://log'; // Adjust if needed
let unlisten: (() => void) | null = null;

async function setupLogListener() {
    if (unlisten) {
        console.log('Log listener already attached.');
        return; // Prevent multiple listeners
    } 
    try {
        console.log(`Attempting to listen for logs on event: ${LOG_EVENT_NAME}`);
        unlisten = await listen<RawLogPayload>(LOG_EVENT_NAME, (event: TauriEvent<RawLogPayload>) => {
            console.debug('Received log event from backend:', event.payload);
            // The payload structure depends on the tracing json formatter and tauri-plugin-log
            // It might be nested, e.g., event.payload.fields, event.payload.message
            addLogEntry(event.payload); 
        });
        console.log(`Log listener attached successfully to ${LOG_EVENT_NAME}`);
    } catch (error) {
        console.error("Failed to set up log listener:", error);
        // Attempt fallback event name if using older plugin version?
        // Consider 'plugin:log|log'
    }
}

// Ensure listener setup is called, e.g., in +layout.svelte
// setupLogListener(); 

// Export the setup function so it can be called from layout
export { setupLogListener };

// Optional: Export unlisten function if manual cleanup is ever needed
// export { unlisten }; 