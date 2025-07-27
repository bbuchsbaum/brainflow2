# Adding New Commands to the API Bridge

When adding a new Tauri command to the api_bridge, you must update **FOUR** places:

## 1. Define the Command Function (lib.rs)
Add your command function with the `#[command]` attribute:
```rust
#[command]
#[tracing::instrument(skip_all, err, name = "api.your_command_name")]
async fn your_command_name(
    param1: String,
    param2: Vec<u32>,
    state: State<'_, BridgeState>,
) -> BridgeResult<YourReturnType> {
    // Implementation
}
```

## 2. Register in build.rs
Add the command name to the `COMMANDS` array:
```rust
const COMMANDS: &[&str] = &[
    // ... existing commands ...
    "your_command_name",  // Add this
];
```

## 3. Register in generate_handler! (lib.rs)
Add the command to the `generate_handler!` macro in the `plugin()` function:
```rust
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("api-bridge")
        .invoke_handler(generate_handler![
            // ... existing commands ...
            your_command_name,  // Add this (note: no quotes!)
        ])
```

## 4. Add to Frontend Transport (transport.ts)
Add the command to the `apiBridgeCommands` array:
```typescript
const apiBridgeCommands = [
  // ... existing commands ...
  'your_command_name'  // Add this
];
```

## Common Pitfalls
- **Missing from generate_handler!**: Command will compile but won't be found at runtime
- **Missing from transport.ts**: Command won't get the `plugin:api-bridge|` namespace prefix
- **Case sensitivity**: Use snake_case everywhere (Tauri handles the conversion)
- **Permissions**: Complex commands may need entries in `permissions/default.toml`

## Testing
After making all changes:
1. The Rust code should recompile automatically with `cargo tauri dev`
2. Test the command from frontend: `await invoke('your_command_name', { param1: 'value' })`
3. Check browser console for any "Command not found" errors