<script lang="ts">
  /**
   * AnnotationToolbar - UI for selecting annotation tools and modes
   * 
   * Provides buttons for different annotation types and manages the active tool state
   */
  import { annotationStore } from '$lib/stores/annotationStore';
  import type { AnnotationToolMode } from '$lib/types/annotations';
  import { downloadAnnotations, loadAnnotationsFromFile } from '$lib/utils/annotationIO';
  
  // Get store state
  const store = annotationStore.getState();
  let activeMode = store.activeToolMode;
  
  // Subscribe to active mode changes
  annotationStore.subscribe((state) => {
    activeMode = state.activeToolMode;
  });
  
  // Tool definitions
  interface Tool {
    mode: AnnotationToolMode;
    label: string;
    icon: string;
    tooltip: string;
  }
  
  const tools: Tool[] = [
    { mode: 'select', label: 'Select', icon: '👆', tooltip: 'Select and move annotations' },
    { mode: 'text', label: 'Text', icon: '📝', tooltip: 'Add text label' },
    { mode: 'marker', label: 'Marker', icon: '📍', tooltip: 'Add marker point' },
    { mode: 'line', label: 'Line', icon: '📏', tooltip: 'Draw line between two points' },
    { mode: 'circle', label: 'Circle', icon: '⭕', tooltip: 'Draw circular ROI' },
    { mode: 'rectangle', label: 'Rectangle', icon: '⬜', tooltip: 'Draw rectangular ROI' },
    { mode: 'measure-distance', label: 'Distance', icon: '↔️', tooltip: 'Measure distance' },
  ];
  
  function setTool(mode: AnnotationToolMode) {
    annotationStore.getState().setActiveToolMode(mode);
  }
  
  function clearSelection() {
    annotationStore.getState().clearSelection();
  }
  
  function deleteSelected() {
    const state = annotationStore.getState();
    const selectedIds = Array.from(state.selectedAnnotationIds);
    state.removeAnnotations(selectedIds);
  }
  
  function toggleVisibility() {
    const state = annotationStore.getState();
    const visible = state.annotations.size > 0 && 
      Array.from(state.annotations.values()).some(a => a.visible);
    
    if (visible) {
      state.hideAll();
    } else {
      state.showAll();
    }
  }
  
  function exportAnnotations() {
    const state = annotationStore.getState();
    const annotations = state.getVisibleAnnotations();
    
    if (annotations.length === 0) {
      alert('No annotations to export');
      return;
    }
    
    downloadAnnotations(annotations, 'json', `annotations_${new Date().toISOString().slice(0, 10)}`);
  }
  
  async function importAnnotations(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) return;
    
    try {
      const annotations = await loadAnnotationsFromFile(file);
      const state = annotationStore.getState();
      state.importAnnotations(annotations, false); // Don't replace existing
      
      alert(`Imported ${annotations.length} annotations`);
    } catch (error) {
      alert(`Failed to import annotations: ${error.message}`);
    }
    
    // Reset input
    input.value = '';
  }
  
  let fileInput: HTMLInputElement;
</script>

<div class="annotation-toolbar">
  <div class="tool-group">
    {#each tools as tool}
      <button
        class="tool-button"
        class:active={activeMode === tool.mode}
        title={tool.tooltip}
        on:click={() => setTool(tool.mode)}
      >
        <span class="tool-icon">{tool.icon}</span>
        <span class="tool-label">{tool.label}</span>
      </button>
    {/each}
  </div>
  
  <div class="action-group">
    <button
      class="action-button"
      title="Toggle visibility"
      on:click={toggleVisibility}
    >
      👁️
    </button>
    
    <button
      class="action-button"
      title="Clear selection"
      on:click={clearSelection}
    >
      ❌
    </button>
    
    <button
      class="action-button danger"
      title="Delete selected"
      on:click={deleteSelected}
    >
      🗑️
    </button>
    
    <button
      class="action-button"
      title="Export annotations"
      on:click={exportAnnotations}
    >
      💾
    </button>
    
    <button
      class="action-button"
      title="Import annotations"
      on:click={() => fileInput.click()}
    >
      📂
    </button>
    
    <input
      bind:this={fileInput}
      type="file"
      accept=".json"
      style="display: none"
      on:change={importAnnotations}
    />
  </div>
</div>

<style>
  .annotation-toolbar {
    display: flex;
    gap: 1rem;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 0.5rem;
    backdrop-filter: blur(10px);
  }
  
  .tool-group {
    display: flex;
    gap: 0.25rem;
  }
  
  .action-group {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
    border-left: 1px solid rgba(255, 255, 255, 0.2);
    padding-left: 1rem;
  }
  
  .tool-button {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.25rem;
    color: white;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .tool-button:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.4);
  }
  
  .tool-button.active {
    background: rgba(0, 255, 0, 0.3);
    border-color: rgba(0, 255, 0, 0.6);
  }
  
  .tool-icon {
    font-size: 1.25rem;
  }
  
  .tool-label {
    font-size: 0.75rem;
  }
  
  .action-button {
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.25rem;
    color: white;
    font-size: 1.25rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .action-button:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.4);
  }
  
  .action-button.danger:hover {
    background: rgba(255, 0, 0, 0.3);
    border-color: rgba(255, 0, 0, 0.6);
  }
  
  @media (max-width: 768px) {
    .tool-label {
      display: none;
    }
    
    .tool-button {
      padding: 0.5rem;
    }
  }
</style>