<script lang="ts">
  import { coreApi } from '$lib/api';
  import { onMount } from 'svelte';
  
  interface CommandDef {
    name: string;
    description: string;
    params: Array<{
      name: string;
      type: string;
      example: any;
    }>;
    testData?: any;
  }
  
  const commands: CommandDef[] = [
    {
      name: 'supports_webgpu',
      description: 'Check if WebGPU is supported',
      params: [],
      testData: {}
    },
    {
      name: 'load_file',
      description: 'Load a neuroimaging file',
      params: [
        { name: 'path', type: 'string', example: '/test-data/unit/toy_t1w.nii.gz' }
      ],
      testData: { path: '/test-data/unit/toy_t1w.nii.gz' }
    },
    {
      name: 'world_to_voxel',
      description: 'Convert world coordinates to voxel coordinates',
      params: [
        { name: 'volume_id', type: 'string', example: 'volume-123' },
        { name: 'world_coord', type: '[number, number, number]', example: [10.5, 20.5, 30.5] }
      ],
      testData: { volume_id: 'volume-123', world_coord: [10.5, 20.5, 30.5] }
    },
    {
      name: 'set_crosshair',
      description: 'Set crosshair position',
      params: [
        { name: 'coords', type: '[number, number, number]', example: [0, 0, 0] }
      ],
      testData: { coords: [0, 0, 0] }
    },
    {
      name: 'set_view_plane',
      description: 'Set view plane (0=Axial, 1=Coronal, 2=Sagittal)',
      params: [
        { name: 'plane_id', type: '0 | 1 | 2', example: 0 }
      ],
      testData: { plane_id: 0 }
    },
    {
      name: 'fs_list_directory',
      description: 'List directory contents',
      params: [
        { name: 'dir', type: 'string', example: '.' }
      ],
      testData: { dir: '.' }
    },
    {
      name: 'render_frame',
      description: 'Render a frame',
      params: [
        { name: 'params', type: 'RenderFrameParams', example: { plane: 'axial', frame_no: 1.0 } }
      ],
      testData: { params: { plane: 'axial', frame_no: 1.0 } }
    }
  ];
  
  let selectedCommand: CommandDef | null = null;
  let paramInput = '';
  let executing = false;
  let result: any = null;
  let error: string | null = null;
  let executionTime = 0;
  
  function selectCommand(cmd: CommandDef) {
    selectedCommand = cmd;
    paramInput = JSON.stringify(cmd.testData || {}, null, 2);
    result = null;
    error = null;
  }
  
  async function executeCommand() {
    if (!selectedCommand) return;
    
    executing = true;
    result = null;
    error = null;
    
    const startTime = performance.now();
    
    try {
      let params: any = {};
      if (paramInput.trim()) {
        params = JSON.parse(paramInput);
      }
      
      console.log(`Executing ${selectedCommand.name} with params:`, params);
      
      // Call the appropriate API method
      const apiMethod = (coreApi as any)[selectedCommand.name];
      if (!apiMethod) {
        throw new Error(`API method ${selectedCommand.name} not found`);
      }
      
      // Extract parameters based on command
      let apiResult;
      switch (selectedCommand.name) {
        case 'supports_webgpu':
          apiResult = await coreApi.supports_webgpu();
          break;
        case 'load_file':
          apiResult = await coreApi.load_file(params.path);
          break;
        case 'world_to_voxel':
          apiResult = await coreApi.world_to_voxel(params.volume_id, params.world_coord);
          break;
        case 'set_crosshair':
          apiResult = await coreApi.set_crosshair(params.coords);
          break;
        case 'set_view_plane':
          apiResult = await coreApi.set_view_plane(params.plane_id);
          break;
        case 'fs_list_directory':
          apiResult = await coreApi.fs_list_directory(params.dir);
          break;
        case 'render_frame':
          apiResult = await coreApi.render_frame(params.params);
          break;
        default:
          throw new Error(`Unknown command: ${selectedCommand.name}`);
      }
      
      result = apiResult;
      executionTime = performance.now() - startTime;
    } catch (err: any) {
      error = err.message || String(err);
      executionTime = performance.now() - startTime;
      console.error('Command execution error:', err);
    } finally {
      executing = false;
    }
  }
  
  onMount(() => {
    console.log('Command Explorer mounted');
  });
</script>

<div class="command-explorer p-4 bg-gray-900 text-white h-full overflow-hidden flex flex-col">
  <h2 class="text-xl font-bold mb-4">🧪 API Bridge Command Explorer</h2>
  
  <div class="flex gap-4 flex-1 overflow-hidden">
    <!-- Command List -->
    <div class="w-1/3 overflow-y-auto">
      <h3 class="text-sm font-semibold mb-2 text-gray-400">Commands</h3>
      <div class="space-y-1">
        {#each commands as cmd}
          <button
            class="w-full text-left p-2 rounded hover:bg-gray-800 transition-colors
                   {selectedCommand?.name === cmd.name ? 'bg-gray-800 border-l-2 border-blue-500' : ''}"
            on:click={() => selectCommand(cmd)}
          >
            <div class="font-mono text-sm text-blue-400">{cmd.name}</div>
            <div class="text-xs text-gray-500">{cmd.description}</div>
          </button>
        {/each}
      </div>
    </div>
    
    <!-- Command Details -->
    <div class="flex-1 flex flex-col overflow-hidden">
      {#if selectedCommand}
        <div class="mb-4">
          <h3 class="text-lg font-semibold mb-2">{selectedCommand.name}</h3>
          <p class="text-sm text-gray-400 mb-4">{selectedCommand.description}</p>
          
          <!-- Parameters -->
          {#if selectedCommand.params.length > 0}
            <div class="mb-4">
              <h4 class="text-sm font-semibold mb-2">Parameters:</h4>
              <div class="space-y-1">
                {#each selectedCommand.params as param}
                  <div class="text-sm">
                    <span class="text-yellow-400">{param.name}</span>: 
                    <span class="text-gray-400">{param.type}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          
          <!-- Input -->
          <div class="mb-4">
            <label class="block text-sm font-semibold mb-2">Input (JSON):</label>
            <textarea
              bind:value={paramInput}
              class="w-full h-32 p-2 bg-gray-800 rounded font-mono text-sm resize-none"
              placeholder="Enter parameters as JSON..."
            />
          </div>
          
          <!-- Execute Button -->
          <button
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold
                   disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={executing}
            on:click={executeCommand}
          >
            {executing ? '⏳ Executing...' : '▶️ Execute'}
          </button>
        </div>
        
        <!-- Results -->
        <div class="flex-1 overflow-y-auto">
          {#if executionTime > 0}
            <div class="text-xs text-gray-500 mb-2">
              Execution time: {executionTime.toFixed(2)}ms
            </div>
          {/if}
          
          {#if error}
            <div class="p-3 bg-red-900/50 border border-red-700 rounded">
              <h4 class="text-sm font-semibold text-red-400 mb-1">❌ Error</h4>
              <pre class="text-xs whitespace-pre-wrap">{error}</pre>
            </div>
          {/if}
          
          {#if result !== null}
            <div class="p-3 bg-green-900/50 border border-green-700 rounded">
              <h4 class="text-sm font-semibold text-green-400 mb-1">✅ Result</h4>
              <pre class="text-xs whitespace-pre-wrap overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex items-center justify-center h-full text-gray-500">
          Select a command to test
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .command-explorer {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace;
  }
  
  pre {
    font-family: inherit;
  }
</style>