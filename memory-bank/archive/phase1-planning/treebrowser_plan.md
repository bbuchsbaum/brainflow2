# PLAN: Registry-Driven File Tree Browser Implementation

**Version:** 1.2 (Incorporating Feedback)
**Status:** Proposed
**Date:** 2024-07-26 // Use ISO 8601 Format

**Context:** This plan details the implementation steps for a read-only, VS Code-style file tree browser in the Brainflow UI (`TreeBrowser.svelte`). It follows the pattern of using a Rust-based `Loader` registry to determine which files are displayable and loadable, ensuring the frontend remains decoupled from specific file types. This version incorporates significant feedback for improved robustness, performance, and maintainability.

**Goal:** Replace the current file loading mechanism in `TreeBrowser.svelte` with a tree view that:
1.  Displays files recursively from a specified root directory (initially `$DOWNLOAD`).
2.  Only shows files that can be loaded by a registered `Loader` in the Rust backend, determined efficiently (ideally via compile-time dispatch or static lookup).
3.  Allows users to click a file in the tree, dispatching an event for the parent component to handle loading.
4.  Provides data to the frontend in a format suitable for efficient virtualization (e.g., flat arrays with parent indices).
5.  Is easily extensible by adding new `Loader` implementations in Rust without UI changes.
6.  Handles errors gracefully, providing structured error information to the frontend.

**Risks:**
*   **Filesystem Performance:** Walking large/deep directories is potentially slow, even with `spawn_blocking` and pre-filtering. Virtualization mitigates frontend jank, but the initial Rust walk can still take time. Limiting depth or using chunking/streaming might be necessary for extreme cases.
*   **Path Handling & Normalization:** Canonicalization helps, but cross-platform differences (separators, case sensitivity) and symlinks still require care. Ensure paths used for IDs and display are consistent.
*   **Scope Mismatches:** The canonicalized path requested in `fs_list_directory` must be validated against the scopes granted declaratively via capabilities. Failure to do so could allow reading outside intended directories.
*   **UI Complexity:** Implementing a fully-featured, performant tree view (expand/collapse, virtualization) adds frontend complexity compared to a simple list.

**Refactoring Strategy:**
*   **Approach:** Implement the Loader trait and associated type changes (Version 1.2) via a **direct, coordinated refactor** across `core/bridge_types`, `core/loaders`, and affected parts of `api_bridge`.
*   **Rationale:** Given the current project stage, the complexity of a feature-flagged migration shim is deemed unnecessary overhead. A direct refactor is simpler, though it requires careful coordination.
*   **Coordination:** Changes to the `Loader` trait, `BridgeError`, `Loaded` enum, loader implementations (`NiftiLoader`, etc.), the loader registry (`core/loaders/mod.rs`), and any callers of the `load` method or handlers of `BridgeError` in `api_bridge` must be performed within the same logical unit of work (e.g., a single branch/PR) to maintain a buildable state.

## Implementation Steps

### Phase 1: Define Loader Core (`core/bridge_types`, `core/loaders`)

*   **Crate Structure:** Keep all concrete loaders (e.g., `NiftiLoader`, `GiftiLoader`) within the `core/loaders` module/crate unless publishing independently. Define shared types (`Loader`, `Loaded`, `BridgeError`) in `core/bridge_types`.

#### Step 1.1: Define `Loader` Trait, `Loaded` Enum, and `BridgeError` Enum
   - **File:** `core/bridge_types/src/lib.rs`
   - **Action:** Define `Loaded` enum, `BridgeError` enum, and the sealed `Loader` trait.
   - **Coordination Note:** This change defines the new API contract used by subsequent steps.
   - **Code:**
     ```rust
     use std::path::{Path, PathBuf};
     use serde::Serialize;
     use thiserror::Error; // Use thiserror for structured errors

     // Define structured error type for bridge operations
     #[derive(Debug, Error, Serialize, Clone)]
     pub enum BridgeError {
         #[error("I/O Error: {details}")]
         Io { code: u16, details: String }, // Example code for mapping

         #[error("Loading Error: {details}")]
         Loader { code: u16, details: String },

         #[error("Permission Denied: {path}")]
         Scope { code: u16, path: String },

         #[error("Invalid Input: {details}")]
         Input { code: u16, details: String },

         #[error("Internal Error: {details}")]
         Internal { code: u16, details: String }, // Generic fallback
     }

     // Define canonical data structures returned by loaders
     #[derive(Debug, Serialize, Clone)]
     #[serde(tag = "type", content = "data")] // Use type/data for clarity
     pub enum Loaded {
         Volume { dims: [u16; 3], dtype: String, path: String },
         Table { rows: usize, cols: usize, path: String },
         Image2D { width: u32, height: u32, path: String },
         Metadata { path: String, loader_type: String },
     }

     impl Loaded {
        // Helper to get the kind easily if needed, though serde tag handles it
        pub fn kind(&self) -> &'static str {
            match self {
                Loaded::Volume { .. } => "Volume",
                Loaded::Table { .. } => "Table",
                Loaded::Image2D { .. } => "Image2D",
                Loaded::Metadata { .. } => "Metadata",
            }
        }
     }

     // Sealed trait pattern
     mod private { pub trait Sealed {} }

     pub trait Loader: private::Sealed + Send + Sync + 'static {
         /// Returns true if the loader can handle the file at the given path.
         /// Checks extensions, magic bytes, etc. Should be fast.
         fn can_load(path: &Path) -> bool where Self: Sized;

         /// Loads the file, returning structured metadata.
         fn load(path: &Path) -> Result<Loaded, BridgeError> where Self: Sized;

         // Optional: Add methods for file type ID, supported extensions etc.
         // const TYPE_ID: u8;
         // fn supported_extensions() -> &'static [&'static str];
     }

     // --- Bridge Result Alias ---
     pub type BridgeResult<T> = Result<T, BridgeError>;
     ```

#### Step 1.2: Implement Loader Registry (`core/loaders`)
   - **File:** `core/loaders/mod.rs`
   - **Action:** Use a `static` slice or similar mechanism for efficient, compile-time (or link-time) loader dispatch. Provide `is_loadable`.
   - **Coordination Note:** This must be updated simultaneously with Step 1.1 and Step 1.3 to reflect the new `Loader::can_load` signature.
   - **Code:**
     ```rust
     use std::path::Path;
     use bridge_types::{Loader, BridgeError, BridgeResult};

     // --- Loader Implementations ---
     mod nifti;
     // mod gifti;
     pub use nifti::NiftiLoader;
     // pub use gifti::GiftiLoader;

     // --- Registry ---
     // Goal: Efficient dispatch, ideally compile-time or static lookup.
     // Option 1: Static array of function pointers (as before). Simple, fast.
     type CanLoadFn = fn(&Path) -> bool;
     static CAN_LOAD_FNS: &[CanLoadFn] = &[
         NiftiLoader::can_load,
         // GiftiLoader::can_load,
     ];

     /// Checks if any registered loader can handle a path using static lookup.
     pub fn is_loadable(path: &Path) -> bool {
         CAN_LOAD_FNS.iter().any(|can_load_fn| can_load_fn(path))
     }

     // Option 2 (Advanced): Link-time registration (e.g., using `linkme` crate)
     // would allow decentralized registration but adds complexity. Stick with static array for now.

     // Option 3 (Future): If loaders provide type IDs / extensions:
     // Build a compile-time map (e.g., `phf`) from extension -> `can_load` fn
     // for O(1) lookup, requires more trait structure.

     // Placeholder function to find the *first* matching loader (if needed for direct load)
     // pub fn find_loader_for(path: &Path) -> Option<fn(&Path) -> BridgeResult<Loaded>> { ... }
     ```

#### Step 1.3: Implement `Loader` for `NiftiLoader`
   - **File:** `core/loaders/nifti/src/lib.rs` (or appropriate path)
   - **Action:** Implement `Loader`, including `private::Sealed`. Use `todo!()` for implementation. **Temporarily comment out outdated `impl From<NiftiError> for BridgeError` block.**
   - **Coordination Note:** Changes here must align with Step 1.1 (trait def) and Step 1.2 (registry registration).
   - **Code:**
     ```rust
     use std::path::Path;
     use bridge_types::{Loader, Loaded, BridgeError, BridgeResult, private};
     // Removed: use async_trait::async_trait;

     #[derive(Default)]
     pub struct NiftiLoader {}

     impl private::Sealed for NiftiLoader {}

     impl Loader for NiftiLoader {
         fn can_load(path: &Path) -> bool {
             // Simple extension check
             path.extension().map_or(false, |ext| {
                 let ext_str = ext.to_string_lossy().to_lowercase();
                 ext_str == "nii" || (ext_str == "gz" && path.file_stem().map_or(false, |stem| stem.to_string_lossy().ends_with(".nii")))
             })
         }

         fn load(path: &Path) -> BridgeResult<Loaded> {
             todo!("BF-TB-04: Implement NiftiLoader::load using new types and error mapping");
             // Placeholder logic removed, actual implementation deferred to BF-TB-04
         }
     }

     // TODO (BF-TB-04): Reimplement this From conversion block to map NiftiError
     // variants to the new BridgeError variants defined in bridge_types v1.2.
     /*
     impl From<NiftiError> for BridgeError {
         fn from(err: NiftiError) -> Self {
             // ... old mapping logic ...
         }
     }
     */
     ```

### Phase 2: Expose IPC Command (`api_bridge`)

#### Step 2.1: Define Tree Payload Structures (`core/bridge_types`)
   - **File:** `core/bridge_types/src/lib.rs`
   - **Action:** Define structures optimized for frontend virtualization (flat lists). Use `parent_idx` instead of `depth`. Include `icon_id`.
   - **Code:**
     ```rust
     use serde::Serialize;
     use std::path::{Path, PathBuf};

     // Represents a node in the file tree, optimized for flat list transfer
     #[derive(Debug, Serialize, Clone)]
     pub struct FlatNode {
         pub id: String,           // Full path (unique identifier)
         pub name: String,         // File/Dir name
         pub parent_idx: Option<usize>, // Index of the parent in the flat list, None for roots
         pub icon_id: u8,          // Numeric ID for icon type (mapped in Rust)
         pub is_dir: bool,
         // Add other minimal metadata needed for display (e.g., file size, modified date)
         // pub size: Option<u64>,
     }

     // The payload returned by the list command
     #[derive(Debug, Serialize, Clone, Default)]
     pub struct TreePayload {
         pub nodes: Vec<FlatNode>,
         // Optional: Can include icon mapping here if needed by TS
         // pub icon_map: std::collections::HashMap<u8, String>,
     }

     // Example Icon ID mapping (could live in loaders or bridge_types)
     pub mod icons {
         pub const FOLDER: u8 = 0;
         pub const FILE: u8 = 1;
         pub const NIFTI: u8 = 2;
         pub const GIFTI: u8 = 3;
         // Add more...
     }
     ```

#### Step 2.2: Ensure Dependencies (`core/api_bridge/Cargo.toml`)
   - **Action:** Ensure `walkdir`, `serde`, `log`, `tracing`, `thiserror` are present. Add `bridge_types` and loader crate paths.
   - **Code:**
     ```toml
     [dependencies]
     walkdir = "2.5"
     serde = { version = "1.0", features = ["derive"] }
     log = "0.4"
     tracing = "0.1"
     thiserror = "1.0"
     anyhow = "1.0" # Keep anyhow for internal error handling context if desired

     bridge_types = { path = "../bridge_types" }
     volmath = { path = "../volmath" } # Or wherever loaders live
     tauri = { version = "2.0.0-beta" } # Ensure Tauri version is specified
     ```

#### Step 2.3: Implement `fs_list_directory` Command
   - **File:** `core/api_bridge/src/fs_commands.rs` (Example location)
   - **Action:** Implement the command using the new types and error handling. Return `BridgeResult<TreePayload>`. Handle macOS bundles.
   - **Coordination Note:** Ensure error handling maps internal errors (IO, JoinError) to the new `BridgeError` variants. Any direct calls to `Loader::load` within other commands would also need updating here.
   - **Code:**
     ```rust
     use crate::BridgeState;
     use bridge_types::{FlatNode, TreePayload, BridgeError, BridgeResult, icons};
     use anyhow::{Context, Result}; // Use anyhow internally if needed
     use tauri::State;
     use std::path::{Path, PathBuf};
     use std::{fs, collections::HashMap}; // Need HashMap for parent tracking
     use walkdir::WalkDir;
     use volmath::loaders; // Adjust path

     fn is_hidden(entry: &walkdir::DirEntry) -> bool { /* ... same as before ... */ }

     // Handle macOS Bundles: Decide whether to treat .app dirs as files or skip them
     const TREAT_APP_BUNDLES_AS_FILES: bool = true; // Example configuration

     fn is_macos_bundle(entry: &walkdir::DirEntry) -> bool {
         cfg!(target_os = "macos") &&
         entry.file_type().is_dir() &&
         entry.path().extension().map_or(false, |ext| ext == "app")
     }

     #[tauri::command(rename_all = "snake_case")] // Use snake_case for invoke name
     #[tracing::instrument(skip(state))]
     pub async fn fs_list_directory(
         state: State<'_, BridgeState>,
         dir: String,
     ) -> BridgeResult<TreePayload> { // Return specific BridgeResult
         let root = fs::canonicalize(&dir).map_err(|e| BridgeError::Io {
             code: 404,
             details: format!("Cannot access directory '{}': {}", dir, e),
         })?;

         // Verify scope (using pseudo-code, replace with actual Tauri scope check)
         // if !state.fs_scope().is_path_allowed(&root) {
         //     return Err(BridgeError::Scope { code: 403, path: root.display().to_string() });
         // }
         log::info!("Listing directory: {}", root.display());

         let result_payload = tauri::async_runtime::spawn_blocking(move || -> BridgeResult<TreePayload> {
             let mut nodes = Vec::new();
             let mut path_to_idx: HashMap<PathBuf, usize> = HashMap::new();

             // Add the root node itself implicitly or handle separately if needed
             // let root_node = FlatNode { id: root.display().to_string(), name: "...".to_string(), parent_idx: None, icon_id: icons::FOLDER, is_dir: true };
             // nodes.push(root_node);
             // path_to_idx.insert(root.clone(), 0);

             for entry_res in WalkDir::new(&root)
                 .min_depth(1) // Start listing contents *within* root
                 .follow_links(false)
                 .into_iter()
                 .filter_entry(|e| !is_hidden(e))
             {
                 let entry = match entry_res {
                     Ok(e) => e,
                     Err(e) => { log::warn!("Skipping entry due to error: {}", e); continue; }
                 };
                 let path = entry.path();

                 let is_bundle_as_file = TREAT_APP_BUNDLES_AS_FILES && is_macos_bundle(&entry);
                 let is_dir = entry.file_type().is_dir() && !is_bundle_as_file;
                 let is_loadable_file = entry.file_type().is_file() || is_bundle_as_file;

                 if is_dir || (is_loadable_file && loaders::is_loadable(path)) {
                     let parent_path = path.parent().unwrap_or(&root).to_path_buf();
                     let parent_idx = path_to_idx.get(&parent_path).copied(); // Find parent index

                     let icon_id = if is_dir {
                         icons::FOLDER
                     } else {
                         // Determine icon based on loaders or extension
                         match path.extension().map(|s| s.to_string_lossy().to_lowercase()) {
                            Some(ext) if ext == "nii" || (ext == "gz" && path.file_stem().map_or(false, |s| s.to_string_lossy().ends_with(".nii"))) => icons::NIFTI,
                            Some(ext) if ext == "gii" => icons::GIFTI,
                            _ => icons::FILE, // Default file icon
                         }
                         // Future: Query loader for icon ID
                     };

                     let current_idx = nodes.len();
                     let node = FlatNode {
                         id: path.to_string_lossy().to_string(),
                         name: entry.file_name().to_string_lossy().to_string(),
                         parent_idx,
                         icon_id,
                         is_dir,
                     };
                     nodes.push(node);
                     path_to_idx.insert(path.to_path_buf(), current_idx); // Store index of this node
                 }
             }
             Ok(TreePayload { nodes })
         }).await.map_err(|e| BridgeError::Internal { // Handle JoinError
             code: 500, details: format!("Filesystem walk task failed: {}", e)
         })??; // Flatten Result<Result<T, E>, JoinError>

         log::info!("Found {} nodes in {}", result_payload.nodes.len(), root.display());
         Ok(result_payload)
     }
     ```

#### Step 2.4: Register Command (`src-tauri/src/main.rs`)
   - **Action:** Register the *prefixed* command name.
   - **Code:**
     ```rust
     mod fs_commands; // Assuming command is in this module

     fn main() {
         // ...
         tauri::Builder::default()
             // ...
             .invoke_handler(tauri::generate_handler![
                 // ... other commands ...
                 fs_commands::fs_list_directory // Register the function
             ])
             // ...
     }
     ```

### Phase 3: Integrate TypeScript API (`@brainflow/api`)

#### Step 3.1: Define Payload Interfaces and Error Type
   - **File:** `packages/api/src/index.ts`
   - **Action:** Define `FlatNode`, `TreePayload`, `IconId`, and `BridgeError`.
   - **Code:**
     ```typescript
     // Mirror Rust icon constants (or fetch map from Rust)
     export enum IconId {
       Folder = 0,
       File = 1,
       Nifti = 2,
       Gifti = 3,
     }

     export interface FlatNode {
       id: string;           // Full path string (unique key)
       name: string;         // File/Dir name
       parent_idx: number | null; // Index of parent in the nodes array
       icon_id: IconId;      // Use the numeric enum
       is_dir: boolean;
       // size?: number; // Optional metadata
     }

     export interface TreePayload {
       nodes: FlatNode[];
       // icon_map?: Record<IconId, string>; // Optional icon name mapping
     }

     // Mirror Rust BridgeError structure
     export interface BridgeError {
       code: number;
       message: string; // Combines error type and details/path
       // Optionally include specific fields like 'path' if needed for Scope errors
       // path?: string;
     }

     // Update Result type to use BridgeError
     export type BridgeResult<T> =
       | { ok: true; data: T }
       | { ok: false; error: BridgeError }; // Use structured error
     ```

#### Step 3.2: Add API Function Signature (`fs_list_directory`)
   - **File:** `packages/api/src/index.ts` (or `coreApi.ts`)
   - **Action:** Add the *prefixed* function signature using `BridgeResult<TreePayload, BridgeError>`.
   - **Code:**
     ```typescript
     import type { BridgeResult, TreePayload } from './index';

     export interface CoreApi {
       // ... existing methods ...

       /** Lists files/dirs, returning flat nodes for virtualization. */
       fs_list_directory(dir: string): Promise<BridgeResult<TreePayload>>;
     }
     ```
   - **Action:** Update the implementation wrapper.
     ```typescript
     // Example in coreApi.ts
     import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
     import type { BridgeResult, TreePayload, BridgeError, CoreApi } from './index';

     async function call<T>(cmd: string, args?: InvokeArgs): Promise<BridgeResult<T>> {
       try {
         const result = await invoke<T>(cmd, args);
         return { ok: true, data: result };
       } catch (error: unknown) {
         // Assume Tauri serializes BridgeError correctly
         // Need to handle potential string errors if serialization fails
         if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
             return { ok: false, error: error as BridgeError };
         } else {
             // Fallback for unexpected error format
             return { ok: false, error: { code: 500, message: String(error) } };
         }
       }
     }

     export const coreApi: CoreApi = {
       // ... existing method wrappers ...
       async fs_list_directory(dir: string): Promise<BridgeResult<TreePayload>> {
         // Invoke using the snake_case name registered in Rust
         return call<TreePayload>('fs_list_directory', { dir });
       }
     };
     ```

### Phase 4: Implement Frontend Tree (`TreeBrowser.svelte`)

#### Step 4.1: Fetch Tree Payload and Store
   - **File:** `ui/src/lib/components/browser/TreeBrowser.svelte` (Example location)
   - **Action:** Fetch using `fs_list_directory`. Store `TreePayload` (or just `nodes`) in a store.
   - **Code:**
     ```svelte
     <script lang="ts">
       import { coreApi, type FlatNode, type TreePayload, type BridgeError, IconId } from '$lib/api';
       import { writable, type Writable } from 'svelte/store';
       import { createEventDispatcher } from 'svelte';
       import { VirtualList } from 'svelte-virtual-list'; // Import virtualization component

       const treePayloadStore: Writable<TreePayload> = writable({ nodes: [] });
       const isLoading = writable(true);
       const errorStore = writable<BridgeError | null>(null);

       let targetDirectory = $state('$DOWNLOAD');
       const dispatch = createEventDispatcher<{ 'load-file': FlatNode }>();

       $effect(() => {
         async function fetchFiles() {
           isLoading.set(true);
           errorStore.set(null);
           treePayloadStore.set({ nodes: [] }); // Clear previous

           const result = await coreApi.fs_list_directory(targetDirectory);

           if (result.ok) {
             treePayloadStore.set(result.data);
           } else {
             errorStore.set(result.error); // Store structured error
           }
           isLoading.set(false);
         }
         fetchFiles();
       });

       // Map IconId to displayable content (e.g., CSS class, emoji)
       function getIconContent(iconId: IconId): string { /* ... map ids ... */ return '❓'; }

       function handleNodeClick(node: FlatNode) {
           if (!node.is_dir) {
               dispatch("load-file", node);
           }
       }

       // Need logic to calculate display depth based on parent_idx if showing indentation
       // function calculateDepth(nodeIndex: number, nodes: FlatNode[]): number { ... }

     </script>

     <div class="tree-browser-container">
         <h4>Files ({targetDirectory})</h4> {#if $isLoading}
             <!-- Loading -->
         {:else if $errorStore}
             <div class="feedback error">Error {$errorStore.code}: {$errorStore.message}</div>
         {:else if $treePayloadStore.nodes.length === 0}
             <!-- Empty -->
         {:else}
             <div class="virtual-list-wrapper">
                 <VirtualList items={$treePayloadStore.nodes} let:item={node} let:index>
                     {@const depth = 0 /* todo: calculateDepth(index, $treePayloadStore.nodes) */}
                     <div class="tree-node"
                          class:is-dir={node.is_dir}
                          style:padding-left="{depth * 15 + 5}px"
                          on:click={() => handleNodeClick(node)}
                          title={node.id}
                     >
                         <span class="icon">{getIconContent(node.icon_id)}</span>
                         {node.name}
                     </div>
                 </VirtualList>
             </div>
         {/if}
     </div>

     <style>
         .virtual-list-wrapper { flex-grow: 1; overflow: hidden; }
         .tree-node { /* Styles for each node row */ }
         /* Other styles... */
     </style>
     ```

#### Step 4.2: Implement Virtualized Rendering
   - **File:** `ui/src/lib/components/browser/TreeBrowser.svelte`
   - **Action:** Use a virtualization library (e.g., `svelte-virtual-list`) **from the start**. Render items based on the flat `nodes` array. Calculate indentation/depth dynamically if needed, or structure data for a tree library.

#### Step 4.3: Implement File Selection (Dispatch Event)
   - **File:** `ui/src/lib/components/browser/TreeBrowser.svelte`
   - **Action:** Add `on:click` to file nodes, dispatching `load-file` with the `FlatNode` data.

### Phase 5: Define Permissions Declaratively

#### Step 5.1: Define FS Permissions in Capabilities
   - **File:** `src-tauri/capabilities/default.json` (or specific capability)
   - **Action:** Define *all* required filesystem read permissions here. Use specific scopes (e.g., `fs:scope-read`, `fs:scope-read-recursive`). **Avoid broad permissions.**
     ```json
     {
       "identifier": "default",
       "description": "Default permissions",
       "windows": ["main"],
       "permissions": [
         // Example: Allow reading $DOWNLOAD non-recursively
         {
           "identifier": "fs:scope-read",
           "allow": ["$DOWNLOAD"]
         },
         // Example: Allow reading $DOWNLOAD/datasets recursively
         {
            "identifier": "fs:scope-read-recursive",
            "allow": ["$DOWNLOAD/datasets"]
         },
         // Deny specific subdirectories if needed
         // {
         //   "identifier": "fs:scope-deny",
         //   "deny": ["$DOWNLOAD/private"]
         // }
         // Allow invoking the specific command
         "ipc:allow-invoke:fs-list-directory"
       ]
     }
     ```
   - **Action:** Minimize or eliminate runtime `allow_directory` calls in `main.rs`. Rely on the declarative capabilities as the single source of truth for permissions. Use runtime checks primarily for narrowing permissions if absolutely necessary.

#### Step 5.2: Verify Scope Handling
   - **Action:** Ensure the Rust command (`fs_list_directory`) correctly canonicalizes the input path and performs scope validation against the *declared* capabilities before accessing the filesystem.

### Phase 6: Implement Polish & Testing

1.  **Clippy:** Run `cargo clippy --workspace --all-targets -- -D warnings`.
2.  **Tracing:** Add `#[tracing::instrument]` and configure a subscriber.
3.  **Unit Tests:**
    *   Use `assert_fs` and `tempfile` crates to create temporary directory structures for testing `fs_list_directory`.
    *   Test `Loader::can_load` implementations thoroughly.
    *   Test `BridgeError` creation and serialization.
    *   **Coordination Note:** Tests calling `Loader::load` directly or asserting against old `BridgeError` variants will need updates or temporary commenting out until the relevant implementation phase (e.g., BF-TB-04). Add `// TODO:` comments.
4.  **Error Handling:** Map `BridgeError` codes to specific UI feedback (e.g., toast notifications, error messages) in the frontend.
5.  **Code Comments:** Explain logic around error codes, scope validation, payload structure, and virtualization choices.

### Phase 7: Plan Future Refinements

*   **Tree View Features:** Implement expand/collapse for directories (requires frontend logic or library).
*   **Live Updates:** Use Tauri events + filesystem watcher (`notify` crate).
*   **Configurable Root:** Allow changing `targetDirectory`.
*   **Icons:** Use SVG icons mapped via CSS classes derived from `icon_id`.
*   **Performance:** Optimize Rust walk/filtering; explore chunking/streaming if needed.

This version (1.2) incorporates the latest feedback, aiming for a more robust, secure, and performant implementation from the outset. 