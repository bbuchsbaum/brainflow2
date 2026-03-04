<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# Tauri Application Shell

## Purpose
The src-tauri directory contains the Tauri v2 application entry point that bootstraps the Brainflow desktop application. It initializes core services (RenderLoopService, AtlasService, TemplateService, SurfaceRegistry), configures tracing/logging, sets up shared state (VolumeRegistry, layer mappings), and registers all Tauri commands from the api_bridge plugin. This is the glue layer that connects the React frontend to the Rust backend services.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Main application setup: initializes tracing, creates shared state, spawns async service initialization, and configures Tauri builder |
| `src/main.rs` | Entry point that simply calls `lib::run()` |
| `src/menu_builder.rs` | Application menu construction (File, Edit, View menus) |
| `tauri.conf.json` | Tauri configuration: window settings, build commands, bundle config, security policies |
| `Cargo.toml` | Dependencies: tauri runtime, api_bridge plugin, core services |
| `build.rs` | Build script for Tauri code generation |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `capabilities/` | Tauri v2 capability definitions for permission-based command access |
| `gen/` | Generated schemas for ACL manifests, capabilities, and platform-specific configs |
| `icons/` | Application icons for different platforms and sizes |

## For AI Agents

### Working In This Directory
When working with the Tauri application shell:
1. **Run development server**: `cargo tauri dev` from project root (NOT from this directory)
2. **Build application**: `cargo tauri build` from project root
3. **Test Rust code**: `cargo test` (tests should be in core crates, not here)
4. **Update capabilities**: Modify files in `capabilities/` and rebuild to regenerate `gen/` schemas
5. **Frontend integration**: Frontend code in `/ui2/` - dev server specified in `tauri.conf.json`

### Testing Requirements
- This crate is primarily a bootstrap layer - most logic should be in core crates
- Integration tests should verify service initialization and command registration
- Manual testing: Run `cargo tauri dev` and verify all services start correctly
- Check logs for proper tracing initialization (info/debug/trace levels)

### Common Patterns
- **Service initialization**: Services initialized asynchronously in separate task during `setup()`
- **Shared state**: Use `Arc<TokioMutex<T>>` for state shared between commands
- **State management**: VolumeRegistry, LayerMap, BridgeState managed via Tauri state
- **Command registration**: All commands come from `api_bridge` plugin - see `core/api_bridge/ADDING_COMMANDS.md`
- **Tracing**: Configured with EnvFilter for flexible log levels (default: `info,brainflow=debug,render_loop=trace`)
- **Menu**: Platform-specific menu handling via `menu_builder.rs`

### Adding New Commands
**Do not add commands here.** Commands belong in `core/api_bridge/`. See `/core/api_bridge/ADDING_COMMANDS.md` for the 4-step process:
1. Define command in `api_bridge/src/lib.rs`
2. Add to `COMMANDS` array in `api_bridge/build.rs`
3. Add to `generate_handler!` macro in `api_bridge/src/lib.rs`
4. Add to `apiBridgeCommands` array in `ui2/src/services/transport.ts`

### Configuration Notes
- **Frontend dev URL**: http://localhost:5174 (Vite server in ui2/)
- **Frontend dist**: `../ui2/dist` for production builds
- **Window size**: 1300x900 (resizable)
- **Security**: Uses capability-based permissions (see `capabilities/` directory)
- **Bundle identifier**: `com.brainflow.dev`

## Dependencies

### Internal
- `api_bridge` - Tauri plugin providing all backend commands
- `render_loop` - WebGPU rendering service
- `atlases` - Brain atlas service
- `templates` - Template brain space service

### External
- `tauri` 2.2.x - Desktop application framework with wry webview
- `tauri-plugin-opener` 2.2.x - File/URL opening
- `tauri-plugin-log` 2.2.x - Logging plugin
- `tracing` 0.1 - Structured logging
- `tracing-subscriber` 0.3 - Log subscriber implementation
- `tracing-log` - Bridge between tracing and log crate
- `tokio` 1.40.0 - Async runtime (with "full" features)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
