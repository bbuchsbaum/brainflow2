docs/DEV-testing-guide.md
Version: 1.0
Status: Adopted for Phase 1 (WebGPU v2)
Date: [Insert Date]
Context: This guide details how developers working on the Brainflow project can run the various types of tests locally to ensure code quality, prevent regressions, and verify functionality across the Rust backend and TypeScript frontend.
1. Overview
Testing is crucial for maintaining the stability and correctness of Brainflow. This guide covers:
Static Analysis: Linters and formatters.
Rust Unit & Integration Tests: Testing individual Rust crates and their interactions.
TypeScript Unit & Component Tests: Testing frontend utilities, stores, and Svelte components.
Adapter Tests: Verifying numerical consistency between ported Rust code (compiled to WASM) and original legacy TypeScript code.
End-to-End (E2E) Tests: Simulating user interactions within the full Tauri application.
Plugin Verification: Checking the validity of first-party and third-party plugins.
Running relevant tests locally before committing or opening Pull Requests is highly encouraged.
2. Prerequisites
Ensure all prerequisites from the docs/DEV-bootstrap-guide.md are installed (Rust toolchain with wasm32-unknown-unknown target, Node.js v20+, pnpm, Tauri CLI, LLVM on Windows).
Install project dependencies:
# From the repository root
pnpm install
Use code with caution.
Bash
Ensure necessary test data fixtures are available (Refer to docs/DATA-fixtures.md or use tools/scripts/fetch-fixtures.ts if applicable).
3. Running Linters and Formatters
These checks ensure code style consistency and catch potential errors early. They are typically run automatically via pre-commit hooks (if configured via Husky/lint-staged) and always in CI.
Rust Formatting & Linting:
# Check formatting (reports differences)
cargo fmt --all --check

# Apply formatting fixes
cargo fmt --all

# Run Clippy linter (reports warnings/errors)
cargo clippy --workspace --all-targets -- -D warnings # Treat warnings as errors
Use code with caution.
Bash
TypeScript/Svelte Formatting & Linting:
# Check formatting (reports differences) - Uses Prettier
pnpm format:check

# Apply formatting fixes
pnpm format

# Run ESLint (reports warnings/errors)
pnpm lint
Use code with caution.
Bash
Note: Assumes format:check, format, and lint scripts are defined in the root package.json leveraging pnpm -r.
4. Running Rust Tests
These tests verify the logic within individual Rust crates (core/*, src-tauri).
Run All Workspace Tests:
cargo test --workspace
Use code with caution.
Bash
Run Tests for a Specific Crate:
# Example: Test only the volmath crate
cargo test -p brainflow-volmath
# Or navigate into the crate directory:
# cd core/volmath && cargo test
Use code with caution.
Bash
Run a Specific Test Function:
# Example: Run test named 'test_grid_to_coord_origin' within its module
cargo test test_grid_to_coord_origin
Use code with caution.
Bash
Watch Mode (requires cargo-watch): Automatically re-run tests on code changes.
# Install: cargo install cargo-watch
cargo watch -x "test --workspace"
Use code with caution.
Bash
5. Running TypeScript/UI Tests (Vitest)
These tests cover frontend utilities, Zustand stores, and Svelte component logic.
Run All TS/UI Unit & Component Tests:
# From the repository root
pnpm test:unit
# Or navigate to the ui directory:
# cd ui && pnpm test
Use code with caution.
Bash
(Assumes test:unit script in root package.json runs vitest run within the ui package).
Run Tests in Watch Mode:
pnpm test:unit --watch
Use code with caution.
Bash
Run Tests for Specific Files:
pnpm test:unit src/lib/stores/viewerStore.test.ts
Use code with caution.
Bash
Run Specific Test Suites or Names (Filtering):
# Run tests matching a specific describe/test name
pnpm test:unit -t "coordinate transformation"
Use code with caution.
Bash
Vitest UI (Optional): Provides a graphical interface for tests.
# Install if needed: pnpm add -D @vitest/ui
pnpm test:unit --ui
Use code with caution.
Bash
6. Running Adapter Tests (Rust-WASM vs Legacy TS)
These specialized tests verify that core numerical functions ported to Rust produce results consistent with the original TypeScript implementations. This is a two-step process.
Build & Run Rust WASM Tests:
This step compiles the Rust code (specifically the volmath crate containing ported logic) to WASM and runs tests annotated with #[wasm_bindgen_test] using Node.js.
# From the repository root
wasm-pack test --node -- --package brainflow-volmath
Use code with caution.
Bash
This verifies the Rust code itself functions correctly in a WASM environment.
Run JavaScript Comparison Tests:
This step runs a separate Vitest/Jest test suite (likely located in packages/legacy-ts/tests or a dedicated packages/adapter-tests) that imports both the compiled WASM module and the legacy TS module and compares their outputs on identical inputs.
# From the repository root (assuming script is configured)
pnpm test:adapter
Use code with caution.
Bash
(Assumes test:adapter script is defined in root package.json).
These tests typically use snapshot testing or expect(...).toBeCloseTo(...) for floating-point comparisons.
CI: Both wasm-pack test and pnpm test:adapter should run in CI, especially on PRs modifying core/volmath or packages/legacy-ts.
7. Running End-to-End (E2E) Tests (Playwright)
E2E tests simulate user interactions within the fully built Tauri application or against the development server.
Running Against Development Server:
Start the development environment in one terminal:
pnpm tauri dev
Use code with caution.
Bash
In another terminal, run the Playwright tests:
pnpm test:e2e
Use code with caution.
Bash
Running Against a Production Build (More Realistic):
Create a production build:
pnpm tauri build
Use code with caution.
Bash
Run Playwright tests targeting the built application (configuration depends on playwright.config.ts setup, might need specific commands or environment variables).
# Example command (may vary based on config)
pnpm test:e2e --project=desktop-production
Use code with caution.
Bash
Playwright UI Mode (Debugging):
pnpm test:e2e --ui
Use code with caution.
Bash
(Assumes test:e2e script in root package.json runs playwright test within the ui package or root).
8. Running Plugin Verification
Use the dedicated tool to check plugin manifest validity and basic structure.
# From the repository root (assuming script is configured)
# Example: Verify the first-party atlas loader
pnpm tool:verify-plugin plugins/atlas-loader
Use code with caution.
Bash
(Assumes tool:verify-plugin script in root package.json executes the verifier tool, likely located in tools/plugin-verify).
9. Continuous Integration (CI)
Most of these test suites (linters, formatters, Rust tests, TS unit tests, adapter tests, potentially E2E smoke tests) are configured to run automatically on every push and Pull Request via GitHub Actions (.github/workflows/ci.yml). Check the workflow file for the exact steps executed in CI. Passing CI checks is generally a prerequisite for merging code.