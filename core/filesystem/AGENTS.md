<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# filesystem

## Purpose
Placeholder crate for file operations, BIDS dataset scanning, and directory mounting functionality. Currently contains only template stub code. Intended to handle filesystem abstraction, BIDS validation, and secure file access patterns for the application.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Template stub with add() function - NOT YET IMPLEMENTED |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| N/A | Not yet implemented |

## For AI Agents

### Working In This Directory
This crate is NOT YET IMPLEMENTED - it contains only template stub code. When implementing, this should handle: file tree traversal, BIDS dataset validation, directory permissions, mount point management, and secure path operations. Coordinate with `api_bridge` file commands. Consider using `walkdir` for traversal and implementing BIDS-compliant directory scanning.

### Testing Requirements
No tests exist yet. When implementing, tests should cover: path validation, BIDS dataset structure validation, permission checking, symlink handling, and cross-platform path compatibility.

### Common Patterns
Not yet established - this is a stub crate awaiting implementation.

## Dependencies

### Internal
None currently

### External
None currently - add as needed during implementation (likely: `walkdir`, `serde`, filesystem permissions crates)

<!-- MANUAL: This crate needs full implementation - currently just a placeholder. -->
