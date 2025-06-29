## Rust/TypeScript Interop: Handles, Metadata, and Proxies (Not Mirror Structs)

- **Heavy data and math** (e.g., `DenseVolume3<T>`, `NeuroSpace`) live only in Rust. TypeScript never re-implements or mirrors these large structures.
- **Interop uses handles:** Rust registers objects (e.g., `VolumeHandle(String)`) and exposes only small, code-generated TS interfaces (via `ts-rs`) for use in the UI and plugins.
- **Shape/metadata only:** TS gets shape/affine/spacing info via small interfaces, not full data copies.
- **Proxies, not mirrors:** TypeScript defines tiny proxy classes (e.g., `DenseVolume3Proxy`) that forward all logic to Rust via IPC, never duplicating math or storage.
- **Zero-copy:** Large buffers are only transferred as `SharedArrayBuffer` when explicitly requested.
- **Checklist:** 
  - Generate typings from Rust, don't re-declare in TS.
  - Proxies live in a dedicated folder, no custom math.
  - Every proxy method corresponds to a Rust command.
  - Unit-test proxies for parity with Rust.

**Bottom line:**  
You do not re-build core math/data structures in TypeScript. You expose handles and metadata, and write minimal proxies that forward to Rust. This keeps the JS bundle slim, avoids GC pressure, and lets you prototype in TS without locking into a slow duplicate implementation. 