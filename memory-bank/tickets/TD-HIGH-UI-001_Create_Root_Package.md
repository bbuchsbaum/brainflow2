# TD-HIGH-UI-001: Create Root package.json

**Priority:** High  
**Module:** UI  
**Stream:** B (TypeScript)  
**Sprint:** 0  
**Effort:** 0.25 days (2 hours)  
**Assignable:** Yes  
**Dependencies:** None

### Problem Description
The monorepo lacks a root package.json file. This causes CI scripts to fail and provides poor developer experience as commands must be run from individual package directories.

### Current State
- No package.json at repository root
- CI references `pnpm test:unit` which doesn't exist
- Developers must cd into directories to run commands
- No unified script commands across packages

### Desired State
- Root package.json with workspace scripts
- Can run all tests from root with `pnpm test`
- Consistent command interface
- CI scripts work correctly

### Technical Approach
1. Create minimal root package.json
2. Add workspace-wide scripts using pnpm -r
3. Add developer convenience scripts
4. Update CI to use root scripts
5. Test all commands work from root

### Implementation Tasks
- [ ] Create /package.json with basic fields
- [ ] Add scripts for test, build, lint, format
- [ ] Add dev script for concurrent development
- [ ] Verify all scripts work correctly
- [ ] Update CI workflow if needed
- [ ] Add to .gitignore if needed
- [ ] Document available commands

### Acceptance Criteria
- [ ] `pnpm test:unit` runs all unit tests
- [ ] `pnpm build` builds all packages
- [ ] `pnpm lint` runs linting across workspace
- [ ] `pnpm format` formats all code
- [ ] CI uses root-level commands
- [ ] No errors when running commands

### Testing Approach
- Manual: Run each script and verify output
- CI: Ensure GitHub Actions workflow passes
- Developer: Ask team to test commands

### Risk Factors
- Very low risk, straightforward task
- May need to adjust some package scripts

### Notes
Example root package.json:
```json
{
  "name": "brainflow2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "cargo tauri dev",
    "build": "pnpm -r build && cargo tauri build",
    "test:unit": "pnpm -r test:unit",
    "test:e2e": "pnpm --filter ui test:e2e",
    "test": "pnpm test:unit && cargo test",
    "lint": "pnpm -r lint && cargo clippy",
    "format": "pnpm -r format && cargo fmt",
    "check": "pnpm -r check"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.1"
  }
}
```

### Code Locations
- `/package.json` - Create this file
- `/.github/workflows/ci.yml` - May need updates

---

## Status Updates

**2025-01-21**: Ticket created based on health audit findings