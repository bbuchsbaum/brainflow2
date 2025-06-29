# Tauri API Bridge Testing Tools

This directory contains tools and utilities for testing and debugging the Tauri API bridge in Brainflow2.

## Overview

The Tauri bridge is the communication layer between the Rust backend and TypeScript frontend. These tools help you:
- Test individual bridge commands without running the full app
- Debug command failures with detailed logging
- Iterate quickly on bridge development
- Validate the bridge works before UI integration

## Tools

### 1. Bridge Explorer UI Component (`ui/src/lib/components/BridgeExplorer.svelte`)
An interactive UI component for testing bridge commands with pre-filled test data.

**Usage:**
```svelte
<script>
  import BridgeExplorer from '$lib/components/BridgeExplorer.svelte';
</script>

<BridgeExplorer />
```

**Features:**
- Pre-configured test data for all commands
- Real-time execution results
- Error display
- Command history

### 2. Bridge Log Viewer (`ui/src/lib/components/BridgeLogViewer.svelte`)
Real-time log viewer for all bridge API calls.

**Usage:**
```svelte
<script>
  import BridgeLogViewer from '$lib/components/BridgeLogViewer.svelte';
</script>

<BridgeLogViewer />
```

**Features:**
- Live log streaming
- Filtering by command/params/results
- Execution timing
- Error highlighting

### 3. Bridge Logger (`ui/src/lib/bridgeLogger.ts`)
TypeScript utility for logging all API calls.

**Usage:**
```typescript
import { loggedCoreApi, bridgeLogger } from '$lib/bridgeLogger';

// Enable logging
bridgeLogger.enable();

// Use logged API
const result = await loggedCoreApi.load_file('/path/to/file.nii');

// Get logs
const logs = bridgeLogger.getLogs();
```

### 4. Test Scripts

#### `test-bridge.js`
Node.js script for testing bridge commands with mock data.

```bash
# Run all tests
./tools/test-bridge.js

# Interactive mode
./tools/test-bridge.js --interactive
```

#### `dev-watch.sh`
Watches for Rust code changes and automatically runs tests.

```bash
./tools/dev-watch.sh
```

Features:
- Auto-recompilation on changes
- Automatic test execution
- Color-coded output
- Continuous feedback loop

#### `test-command.sh`
Quick reference for bridge commands and browser testing.

```bash
# Show all commands
./tools/test-command.sh

# Show specific command example
./tools/test-command.sh load_file
```

#### `setup-test-data.sh`
Verifies test data is available and provides quick test commands.

```bash
./tools/setup-test-data.sh
```

## Testing Workflow

### 1. Quick Iteration (Recommended)

1. Start the watch script:
   ```bash
   ./tools/dev-watch.sh
   ```

2. In another terminal, make changes to `core/api_bridge/src/lib.rs`

3. Tests run automatically on save

### 2. UI Testing

1. Add components to a test page:
   ```svelte
   <script>
     import BridgeExplorer from '$lib/components/BridgeExplorer.svelte';
     import BridgeLogViewer from '$lib/components/BridgeLogViewer.svelte';
   </script>
   
   <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
     <BridgeExplorer />
     <BridgeLogViewer />
   </div>
   ```

2. Run Tauri dev:
   ```bash
   cargo tauri dev
   ```

3. Use the UI to test commands interactively

### 3. Console Testing

1. Start Tauri dev:
   ```bash
   cargo tauri dev
   ```

2. Open browser console (F12)

3. Test commands directly:
   ```javascript
   // Test WebGPU support
   await window.__TAURI__.core.invoke('plugin:api-bridge|supports_webgpu')
   
   // Load a file
   await window.__TAURI__.core.invoke('plugin:api-bridge|load_file', {
     path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz'
   })
   
   // List directory
   await window.__TAURI__.core.invoke('plugin:api-bridge|fs_list_directory', {
     dir: '/Users/bbuchsbaum/code/brainflow2/test-data'
   })
   ```

### 4. Rust Unit Tests

Run the API bridge tests directly:
```bash
cd core/api_bridge
cargo test
```

### 5. TypeScript Unit Tests

Run the frontend API tests:
```bash
cd ui
pnpm test:unit
```

## Debugging Tips

### Common Issues

1. **"Permission denied" errors**
   - Check capabilities in `src-tauri/capabilities/default.json`
   - Ensure `api-bridge:default` is included

2. **"Command not found" errors**
   - Verify command is listed in `generate_handler!` macro
   - Check command name matches exactly (including underscores)

3. **"Volume not found" errors**
   - Ensure you've loaded a file first
   - Check the volume ID matches what was returned

4. **WebGPU not supported**
   - This is normal in some environments
   - The render loop service may not initialize without GPU

### Debug Process

1. **Enable logging**:
   ```typescript
   import { bridgeLogger } from '$lib/bridgeLogger';
   bridgeLogger.enable();
   ```

2. **Check Rust logs**:
   Look for println! statements in the Rust console where `cargo tauri dev` is running

3. **Check browser console**:
   Bridge logger outputs formatted logs with timing

4. **Use the Log Viewer**:
   Add BridgeLogViewer component for visual debugging

## Adding New Commands

1. **Define in Rust** (`core/api_bridge/src/lib.rs`):
   ```rust
   #[command]
   async fn my_new_command(param: String, state: State<'_, BridgeState>) -> BridgeResult<String> {
       println!("Bridge: my_new_command called with {}", param);
       Ok(format!("Processed: {}", param))
   }
   ```

2. **Add to plugin**:
   ```rust
   .invoke_handler(generate_handler![
       // ... existing commands
       my_new_command
   ])
   ```

3. **Add TypeScript wrapper** (`ui/src/lib/api.ts`):
   ```typescript
   async function my_new_command(param: string): Promise<string> {
       return invoke<string>('plugin:api-bridge|my_new_command', { param });
   }
   ```

4. **Test it**:
   - Add to BridgeExplorer commands array
   - Run tests with dev-watch.sh
   - Test in browser console

## Performance Testing

To measure command performance:

1. Use the Bridge Logger (includes timing)
2. Check the BridgeLogViewer duration column
3. For detailed profiling, add timing in Rust:
   ```rust
   let start = std::time::Instant::now();
   // ... command logic
   println!("Command took: {:?}", start.elapsed());
   ```

## Contributing

When adding new bridge functionality:
1. Add appropriate test cases
2. Update the command reference in `test-command.sh`
3. Add to BridgeExplorer's command list
4. Document any new patterns or requirements