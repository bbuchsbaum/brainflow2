# Test Plan for Panel and Control Components

## Overview

This document outlines the comprehensive test plan for the panel and control components in the Brainflow2 UI. These components handle critical user interactions including layer management, file browsing, and configuration controls.

## Components Under Test

### 1. LayerPanel.svelte

**Functionality:** Unified layer selection and controls
**Key Responsibilities:**

- Display active layers list
- Layer selection and activation
- Layer visibility toggling
- Layer removal
- Colormap selection
- Opacity control
- Intensity range adjustment
- Threshold configuration

### 2. FileBrowserPanel.svelte

**Functionality:** File browser with integrated layer management
**Key Responsibilities:**

- File tree display with MountableTreeBrowser
- File loading on double-click
- Drag and drop file support
- Recent files management
- Auto-layer creation
- Event-driven architecture integration

### 3. MountableTreeBrowser.svelte

**Functionality:** Tree browser with mount management
**Key Responsibilities:**

- Directory mounting/unmounting
- File tree navigation
- File filtering by extensions
- File selection and loading
- Drag and drop support
- Native menu integration

## Test Coverage Analysis

### Current State

- **TreeBrowser.test.ts** exists with basic test structure but references a non-existent TreeBrowser.svelte
- No tests exist for LayerPanel, FileBrowserPanel, or MountableTreeBrowser
- Test utilities mentioned in TreeBrowser.test.ts don't exist

### Missing Coverage

1. LayerPanel component tests
2. FileBrowserPanel component tests
3. MountableTreeBrowser component tests
4. Integration tests between components
5. Service integration tests
6. Event handling tests
7. Error handling and edge cases

## Priority Test Cases

### Priority 1: Critical User Flows

#### LayerPanel Tests

1. **Layer Selection**

   - Single layer selection
   - Active layer highlighting
   - Selection state persistence
   - Event emission on selection

2. **Layer Visibility**

   - Toggle visibility button
   - Visual feedback (Eye/EyeOff icon)
   - Service call verification
   - Error handling

3. **Layer Controls**
   - Colormap selection and preview
   - Opacity slider interaction
   - Intensity range adjustment
   - Threshold enable/disable
   - Debounced updates

#### FileBrowserPanel Tests

1. **File Loading**

   - Double-click file loading
   - Loading state management
   - Success notification
   - Error handling with notifications

2. **Drag and Drop**

   - File drop acceptance
   - Extension validation
   - Multiple file handling
   - Visual feedback

3. **Recent Files**
   - Adding to recent files
   - Recent file persistence
   - Clear recent files confirmation
   - Loading from recent

#### MountableTreeBrowser Tests

1. **Mount Management**

   - Directory mounting
   - Mount expansion/collapse
   - Active mount selection
   - Unmount confirmation

2. **File Navigation**

   - Directory expansion
   - File selection
   - Double-click loading
   - Keyboard navigation

3. **File Filtering**
   - Extension filter application
   - Preset filter selection
   - Filter persistence per mount

### Priority 2: Service Integration

1. **LayerService Integration**

   - Layer creation
   - GPU resource requests
   - Layer updates
   - Error propagation

2. **VolumeService Integration**

   - Volume loading
   - Handle management
   - Error handling

3. **NotificationService Integration**
   - Success messages
   - Error messages
   - Confirmation dialogs

### Priority 3: Event System

1. **Event Emission**

   - Layer selection events
   - File loading events
   - Mount change events
   - Error events

2. **Event Handling**
   - External load requests
   - Configuration changes
   - Cross-component communication

## Test Implementation Recommendations

### 1. Test Utilities Setup

Create missing test utilities:

```typescript
// src/lib/test-utils/mockDI.ts
export function createMockDIContainer() {
	const services = new Map();
	return {
		get: (name: string) => services.get(name),
		set: (name: string, service: any) => services.set(name, service),
		services
	};
}

// src/lib/test-utils/mockEventBus.ts
export function createMockEventBus() {
	const listeners = new Map();
	return {
		emit: vi.fn(),
		on: vi.fn((event, handler) => {
			listeners.set(event, handler);
			return () => listeners.delete(event);
		}),
		listeners
	};
}

// src/lib/test-utils/mockStores.ts
export function createMockLayerStore() {
	let layers = [];
	return {
		getLayers: () => layers,
		subscribe: vi.fn(),
		addLayer: vi.fn(),
		removeLayer: vi.fn(),
		setActiveLayer: vi.fn()
	};
}
```

### 2. LayerPanel Test Example

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import LayerPanel from './LayerPanel.svelte';
import { layerStore } from '$lib/stores/layerStore';

vi.mock('$lib/stores/layerStore');
vi.mock('$lib/di/Container');

describe('LayerPanel', () => {
	beforeEach(() => {
		// Setup mock layer data
		layerStore.getLayers.mockReturnValue([
			{
				id: 'layer1',
				spec: { Volume: { id: 'layer1', colormap: 'grayscale' } },
				visible: true,
				volumeInfo: { data_range: [0, 255] }
			}
		]);
	});

	it('should toggle layer visibility', async () => {
		const { container } = render(LayerPanel);

		const visibilityButton = screen.getByTitle('Hide layer');
		fireEvent.click(visibilityButton);

		await waitFor(() => {
			expect(mockLayerService.updateLayer).toHaveBeenCalledWith('layer1', {
				visible: false
			});
		});
	});

	it('should update colormap on selection', async () => {
		render(LayerPanel);

		// Select layer first
		const layerItem = screen.getByText('layer1').closest('.layer-item');
		fireEvent.click(layerItem);

		// Select new colormap
		const viridisButton = screen.getByTitle('Viridis');
		fireEvent.click(viridisButton);

		await waitFor(() => {
			expect(mockLayerService.updateLayer).toHaveBeenCalledWith('layer1', {
				colormap: 'viridis'
			});
		});
	});
});
```

### 3. FileBrowserPanel Test Example

```typescript
describe('FileBrowserPanel', () => {
	it('should handle file drop with validation', async () => {
		render(FileBrowserPanel);

		const dropZone = screen.getByRole('region', { name: 'File browser' });

		const file = new File(['content'], 'brain.nii.gz', { type: 'application/gzip' });
		const dataTransfer = {
			files: [file],
			dropEffect: 'copy'
		};

		fireEvent.drop(dropZone, { dataTransfer });

		await waitFor(() => {
			expect(mockVolumeService.loadVolume).toHaveBeenCalled();
			expect(screen.getByText('Loaded brain.nii.gz')).toBeInTheDocument();
		});
	});
});
```

### 4. Integration Test Example

```typescript
describe('Layer Management Integration', () => {
	it('should create layer from file browser', async () => {
		// Render both components
		render(FileBrowserPanel);
		render(LayerPanel);

		// Load file from browser
		const fileNode = screen.getByText('test.nii');
		fireEvent.dblClick(fileNode);

		await waitFor(() => {
			// Verify layer appears in panel
			const layerPanel = screen.getByText('test.nii').closest('.layer-item');
			expect(layerPanel).toBeInTheDocument();
		});
	});
});
```

## Testing Best Practices

1. **Component Isolation**

   - Mock all external dependencies
   - Test component logic independently
   - Use test-ids for reliable element selection

2. **User Interaction Testing**

   - Test from user perspective
   - Verify visual feedback
   - Test keyboard accessibility

3. **Async Operations**

   - Use waitFor for async updates
   - Test loading states
   - Test error states

4. **Event Testing**

   - Verify correct events are emitted
   - Test event payloads
   - Test event handler cleanup

5. **Accessibility Testing**
   - Test ARIA attributes
   - Test keyboard navigation
   - Test screen reader compatibility

## Test Execution Strategy

1. **Phase 1: Core Functionality (Week 1)**

   - Basic component rendering
   - User interactions
   - State management

2. **Phase 2: Integration (Week 2)**

   - Service integration
   - Event system
   - Cross-component flows

3. **Phase 3: Edge Cases (Week 3)**
   - Error handling
   - Performance (debouncing)
   - Accessibility

## Success Metrics

- 80%+ code coverage for all components
- All critical user flows tested
- All error scenarios handled
- Zero flaky tests
- Sub-100ms test execution per test
