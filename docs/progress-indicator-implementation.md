# Progress Indicator Implementation

## Overview
We've implemented a comprehensive progress tracking system for Brainflow2 that supports both frontend and backend-initiated progress tracking for long-running operations.

## Architecture

### 1. Progress Store (`progressStore.ts`)
- Zustand store with immer middleware for immutable updates
- Tracks multiple concurrent tasks with Map data structure
- Auto-cleanup of completed tasks after 30 seconds
- Optimized to prevent unnecessary re-renders

### 2. Progress Service (`ProgressService.ts`)
- Singleton service that bridges EventBus and Tauri events
- Listens for both frontend events (file.loading) and backend events (progress:*)
- Provides methods for manual progress tracking
- Maintains task ID mappings for correlating events

### 3. UI Components

#### GlobalProgressBar
- Minimal progress bar at top of window
- Shows aggregate progress of all active tasks
- Supports both determinate and indeterminate progress
- Uses shimmer animation for indeterminate state

#### StatusBarProgress
- Compact indicator in status bar
- Shows current task with progress animation
- Click to open detailed progress drawer
- Displays task count badge when multiple tasks active

#### ProgressDrawer
- Slide-out panel with detailed task list
- Shows all active and recent tasks
- Displays progress bars, timing, and error messages
- Allows cancellation of cancellable tasks
- Clear completed tasks button

### 4. Backend Integration
- Backend emits progress events via Tauri:
  - `progress:start` - Initialize new task
  - `progress:update` - Update progress percentage
  - `progress:complete` - Mark task as completed
  - `progress:error` - Mark task as failed
  - `progress:cancel` - Cancel a task
- Example implementation in `load_file` command

## Key Features

1. **Multiple Task Types**: file-load, computation, export, rendering, generic
2. **Progress States**: active, completed, error, cancelled
3. **Determinate & Indeterminate**: Support for both progress types
4. **Auto-cleanup**: Completed tasks removed after 30 seconds
5. **Performance Optimized**: Selective subscriptions prevent re-renders
6. **Cancellation Support**: Tasks can be marked as cancellable

## Usage

### Frontend Task
```typescript
const progressService = getProgressService();
const taskId = progressService.startTask('computation', 'Processing data', {
  message: 'Analyzing...',
  cancellable: true
});

// Update progress
progressService.updateTask(taskId, 50, 'Halfway done');

// Complete
progressService.completeTask(taskId);
```

### Backend Task
```rust
let task_id = format!("file-load-{}", uuid::Uuid::new_v4());
app.emit("progress:start", json!({
    "taskId": task_id,
    "type": "file-load",
    "title": "Loading file.nii",
    "cancellable": false
}));

// Update
app.emit("progress:update", json!({
    "taskId": task_id,
    "progress": 50
}));

// Complete
app.emit("progress:complete", json!({
    "taskId": task_id
}));
```

## Testing
Services are exposed in development mode via `window.__BRAINFLOW_SERVICES` for testing.