# DEV‐logging-diagnostics.md: Observability Layer

(Reference this from the "Guard-rails" section of ADR-002 and the contributor guide)

⸻

## 1 · Goals

| need                                                                    | prescription                                                                                                                              |
| :---------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| One log stream that covers Rust, Tauri, front-end TS and WebGPU validation | Bridge everything to `tracing` spans on the Rust side and a structured JSON channel that the UI consumes.                                   |
| Zero-config for dev                                                     | `RUST_LOG=brainflow=debug tauri dev` prints coloured logs in both terminals and the browser console.                                        |
| Minimal prod overhead                                                   | Default compile flags: `tracing` compiled with `max_level_info`, heavy spans behind the `trace` feature.                                   |
| Correlate a UI action with GPU work                                     | A per-request `Correlation-ID` (UUIDv4) is injected in the `CoreApi` macro; appears in every span until the promise resolves.               |
| Crash & error collection                                                | Error spans enriched with `{ volume_id, path, dtype, backtrace }`, forwarded to Sentry/Logtail only in release builds.                      |


⸻

## 2 · Rust side (all crates)

```toml
# Cargo.toml (workspace.dependencies)
tracing          = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt", "json"] }
tauri-plugin-log = "2.5" # Ensure compatibility with Tauri v2
```

```rust
// src-tauri/src/main.rs  (early in setup)
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

tauri::Builder::default()
    .setup(|app| {
        let filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info,brainflow=debug,render_loop=trace"));
        let fmt_layer = fmt::layer()
            .with_target(true)
            .with_line_number(true)
            .with_file(true);

        let logger_writer = tauri_plugin_log::LoggerBuilder::new() // Get the writer
            .build(app.handle())
            .expect("Failed to initialize Tauri logger writer");

        tracing_subscriber::registry()
            .with(filter)
            .with(fmt_layer) // For terminal output
            .with(tracing_subscriber::fmt::layer().json().with_writer(logger_writer)) // For UI stream
            .init();

        Ok(())
    })
    .plugin(tauri_plugin_log::Builder::default().build())      // Initializes the plugin itself

// Use the #[tracing::instrument(skip(self))] attribute on every Tauri
// command and on hot paths such as RenderLoopService::upload_slice.

#[command]
#[tracing::instrument(name = "core.load_file", skip(state), err)]
async fn load_file(path: String, state: State<'_, BridgeState>)
                  -> BridgeResult<VolumeHandleInfo> {
    // ... implementation ...
}

// `err` automatically records error variants into the span if the function returns Result.
```

⸻

## 3 · Correlation ID helper

```rust
/// Macro used by every CoreApi entry point to create a root span with a unique ID.
#[macro_export]
macro_rules! new_request_span {
    ($name:literal) => {
        tracing::info_span!($name, request_id = %uuid::Uuid::new_v4())
    };
}

// usage
#[command]
#[tracing::instrument(skip(state), err)] // Basic instrumentation
async fn world_to_voxel(/* ... */ state: State<'_, BridgeState>) -> BridgeResult<_> {
    // Enter the request span manually if needed for fine-grained control,
    // otherwise #[instrument] handles it. If using manually, ensure it's dropped.
    let _span = new_request_span!("core.world_to_voxel").entered();
    // ... implementation ...
    Ok(()) // Example
}

// The UI stores request_id (if returned/logged) with the promise/call context;
// any later error dialog can filter messages using this ID.
```

⸻

## 4 · Front-end (Svelte / TS)

```typescript
// src/lib/stores/logStore.ts (Example location)
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

// Store options
const MAX_LOG_ENTRIES = 500;

// Writable store for log entries
export const logEntries = writable<LogEntry[]>([]);

// Function to parse and add log entries
function addLogEntry(rawPayload: any) {
    // Basic validation and type mapping
    const levelMap = {
        'TRACE': 'TRACE', 'DEBUG': 'DEBUG', 'INFO': 'INFO', 'WARN': 'WARN', 'ERROR': 'ERROR'
    };
    const level = levelMap[rawPayload.level as keyof typeof levelMap] || 'INFO';

    const entry: LogEntry = {
        timestamp: rawPayload.timestamp || new Date().toISOString(),
        level: level,
        message: rawPayload.message || 'Unknown log message',
        target: rawPayload.target,
        file: rawPayload.file,
        line: rawPayload.line,
        data: rawPayload.fields || {}, // Extract structured fields
        request_id: rawPayload.fields?.request_id // Extract correlation ID if available
    };

    logEntries.update(currentLogs => {
        const newLogs = [...currentLogs, entry];
        // Limit the number of entries stored
        return newLogs.slice(Math.max(newLogs.length - MAX_LOG_ENTRIES, 0));
    });
}


// Listen for log events from the Rust backend via tauri-plugin-log
let unlisten: (() => void) | null = null;
async function setupLogListener() {
    if (unlisten) return; // Prevent multiple listeners
    try {
        unlisten = await listen<any>('log://log', (event: TauriEvent<any>) => {
            console.debug('Received log event from backend:', event.payload);
            addLogEntry(event.payload);
        });
        console.log("Log listener attached to 'log://log'");
    } catch (error) {
        console.error("Failed to set up log listener:", error);
    }
}

// Call this early in your app setup, e.g., in +layout.svelte onMount
setupLogListener();

// Cleanup listener on app close if necessary (Tauri might handle this)
// window.addEventListener('beforeunload', () => unlisten?.());

```

Add a "Diagnostics" drawer component that renders the `logEntries` store with filtering by level / `request_id`.

For browser-side code, use `tslog` or `pino` for structured logging. Example:

```typescript
// src/lib/utils/logger.ts
import { Logger } from 'tslog';

export const uiLogger = new Logger({
    name: 'UI',
    minLevel: import.meta.env.DEV ? 2 : 3, // Debug in dev, Info in prod
    // Optional: Add transport to send logs to Tauri backend if needed
});

// Usage:
// uiLogger.info("Component mounted", { component: 'VolumeView' });
// uiLogger.error("Failed to load data", errorInstance);
```

⸻

## 5 · GPU validation & WGPU back-end

Enable WGSL and device validation only in development builds. Environment variables can control this:

```bash
# Example for development shell
export WGPU_VALIDATION=1 # Enable API validation
export WGPU_WGSL_VALIDATION=1 # Enable WGSL shader validation
export WGPU_DEBUG=1 # More verbose internal logs
export WGPU_TRACE_PATH=/tmp/wgpu_trace # Optional: Path for API trace capture
export RUST_LOG=warn,wgpu_core=warn,wgpu_hal=warn,naga=warn # Adjust log levels
```

The `RenderLoopService` should initialize `wgpu::Instance` potentially enabling `wgpu::InstanceFlags::VALIDATION` based on a debug flag or environment variable. Request `wgpu::Features::SHADER_VALIDATION` on the device descriptor conditionally for development.

```rust
// Example in RenderLoopService::new()
let instance_flags = if cfg!(debug_assertions) {
    wgpu::InstanceFlags::VALIDATION | wgpu::InstanceFlags::DEBUG
} else {
    wgpu::InstanceFlags::empty()
};
let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
    backends: wgpu::Backends::PRIMARY,
    flags: instance_flags,
    ..Default::default()
});

// ... later when requesting device ...
let required_features = if cfg!(debug_assertions) {
    wgpu::Features::SHADER_VALIDATION // Example feature
} else {
    wgpu::Features::empty()
};
let (device, queue) = adapter.request_device(
    &wgpu::DeviceDescriptor {
        required_features,
        .. // other descriptors
    },
    None,
).await?;
```

Ensure the WGPU error handler (`device.on_uncaptured_error`) is set up to pipe errors into the `tracing` system:

```rust
// Inside RenderLoopService setup
let device_clone = device.clone(); // Clone Arc for the closure
device.on_uncaptured_error(Box::new(move |e: wgpu::Error| {
    tracing::error!(target: "wgpu_error", error = ?e, "Uncaptured WGPU error");
    // Optional: Trigger more drastic action like attempting device recreation
}));
```

⸻

## 6 · Error propagation contract

| Layer                  | Carrier                                  | Action                                                        |
| :--------------------- | :--------------------------------------- | :------------------------------------------------------------ |
| Rust → TS (Command)  | `BridgeResult::Err(BridgeError)`         | UI toast/modal using `error.message`, full error logged to UI console/store via `tauri-plugin-log`, correlation ID logged. |
| WGSL Runtime Error     | `device.on_uncaptured_error` callback    | `tracing::error!` piped via `tauri-plugin-log` to UI store.     |
| TS Caught `Promise` Rejection | `catch (err)` block in UI code         | Log via `uiLogger.error({err, request_id?})`, optional toast.   |

`BridgeError` variants should ideally include the `request_id` if the error originates from a command context.

⸻

## 7 · Checklist for every new feature

1.  **Tauri Command:** Wrap the public command function with `#[tracing::instrument(skip_all, err)]` (or specify fields to log). Use `.entered()` from `new_request_span!` if manual span control is needed.
2.  **Async Tasks:** Pass the current span (`tracing::Span::current()`) to child async tasks using `tracing::Instrument::instrument`.
3.  **Logging:** Emit at least:
    *   `tracing::info!("Loaded volume"; path = %path, dims = ?dims, dtype = %dtype)` (example structured log)
    *   `tracing::error!(error = ?e, "Optional context message")` on failure within `Result::map_err` or `match Err`.
4.  **UI Error Handling:** In Svelte/TS, use `try...catch` around `coreApi` calls. Surface user-friendly messages via toasts/status bar. Log the full technical error details (including `request_id` if available) using `uiLogger`.

⸻

## Summary

This lightweight scheme provides:
*   Single-line setup for core tracing.
*   Minimal performance impact in release builds.
*   Cross-component correlation via `request_id`.
*   A developer-friendly Diagnostics panel in the UI.
*   Integration with WGPU validation and error handling.
*   A clear path to integrate external log sinks (e.g., Sentry) later by adding another `tracing_subscriber` layer.

**Action:** Link this document from `CONTRIBUTING.md` and `docs/ADR-002-multilayer-rendering.md`. 