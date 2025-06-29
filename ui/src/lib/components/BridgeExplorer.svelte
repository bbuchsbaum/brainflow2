<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { bridgeLogger, loggedCoreApi, type BridgeLogEntry } from '../bridgeLogger';
    import type { LayerSpec } from '../api';

    // Command definitions with pre-filled test data
    const commands = [
        {
            name: 'load_file',
            description: 'Load a NIfTI/GIfTI file',
            params: [
                { name: 'path', type: 'string', default: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz' }
            ]
        },
        {
            name: 'supports_webgpu',
            description: 'Check if WebGPU is supported',
            params: []
        },
        {
            name: 'fs_list_directory',
            description: 'List directory contents',
            params: [
                { name: 'dir', type: 'string', default: '/Users/bbuchsbaum/code/brainflow2/test-data' }
            ]
        },
        {
            name: 'world_to_voxel',
            description: 'Convert world to voxel coordinates',
            params: [
                { name: 'volume_id', type: 'string', default: 'volume-123' },
                { name: 'world_coord', type: 'array', default: '[10.5, 20.3, 30.1]' }
            ]
        },
        {
            name: 'set_crosshair',
            description: 'Set crosshair position',
            params: [
                { name: 'coords', type: 'array', default: '[100, 150, 75]' }
            ]
        },
        {
            name: 'set_frame_params',
            description: 'Set frame parameters',
            params: [
                { name: 'origin', type: 'array', default: '[0, 0, 0, 1]' },
                { name: 'u_basis', type: 'array', default: '[1, 0, 0, 0]' },
                { name: 'v_basis', type: 'array', default: '[0, 1, 0, 0]' }
            ]
        },
        {
            name: 'request_layer_gpu_resources',
            description: 'Request GPU resources for a layer',
            params: [
                { name: 'layer_spec', type: 'object', default: '{"type": "Volume", "id": "layer-1", "source_resource_id": "volume-123", "colormap": "grayscale"}' }
            ]
        }
    ];

    let selectedCommand = commands[0];
    let paramValues: Record<string, string> = {};
    let logs: BridgeLogEntry[] = [];
    let isExecuting = false;
    let result: any = null;
    let error: any = null;

    // Initialize param values
    function initParamValues() {
        paramValues = {};
        selectedCommand.params.forEach(param => {
            paramValues[param.name] = param.default || '';
        });
    }

    // Parse parameter value based on type
    function parseParamValue(value: string, type: string): any {
        switch (type) {
            case 'array':
                return JSON.parse(value);
            case 'object':
                return JSON.parse(value);
            case 'number':
                return Number(value);
            case 'boolean':
                return value === 'true';
            default:
                return value;
        }
    }

    // Execute the selected command
    async function executeCommand() {
        isExecuting = true;
        result = null;
        error = null;

        try {
            const args = selectedCommand.params.map(param => 
                parseParamValue(paramValues[param.name], param.type)
            );

            const fn = (loggedCoreApi as any)[selectedCommand.name];
            if (!fn) {
                throw new Error(`Command ${selectedCommand.name} not found`);
            }

            result = await fn(...args);
        } catch (err) {
            error = err;
        } finally {
            isExecuting = false;
        }
    }

    // Subscribe to logs
    let unsubscribe: (() => void) | null = null;

    onMount(() => {
        bridgeLogger.enable();
        logs = bridgeLogger.getLogs();
        unsubscribe = bridgeLogger.onLog((log) => {
            logs = [...logs, log];
            if (logs.length > 50) {
                logs = logs.slice(-50);
            }
        });
        initParamValues();
    });

    onDestroy(() => {
        if (unsubscribe) {
            unsubscribe();
        }
    });

    $: if (selectedCommand) {
        initParamValues();
    }
</script>

<div class="bridge-explorer">
    <h2>🔌 Bridge Command Explorer</h2>
    
    <div class="command-section">
        <label>
            Command:
            <select bind:value={selectedCommand}>
                {#each commands as cmd}
                    <option value={cmd}>{cmd.name}</option>
                {/each}
            </select>
        </label>
        
        <p class="description">{selectedCommand.description}</p>
        
        <div class="params">
            {#each selectedCommand.params as param}
                <label>
                    {param.name} ({param.type}):
                    <input 
                        type="text" 
                        bind:value={paramValues[param.name]}
                        placeholder={param.default || ''}
                    />
                </label>
            {/each}
        </div>
        
        <button 
            on:click={executeCommand} 
            disabled={isExecuting}
            class="execute-btn"
        >
            {isExecuting ? 'Executing...' : 'Execute'}
        </button>
    </div>

    {#if result !== null || error !== null}
        <div class="result-section">
            <h3>Result:</h3>
            {#if error}
                <pre class="error">{JSON.stringify(error, null, 2)}</pre>
            {:else}
                <pre class="success">{JSON.stringify(result, null, 2)}</pre>
            {/if}
        </div>
    {/if}

    <div class="logs-section">
        <h3>Recent Logs:</h3>
        <div class="logs">
            {#each logs.slice(-10).reverse() as log}
                <div class="log-entry {log.error ? 'error' : 'success'}">
                    <span class="command">{log.command}</span>
                    <span class="duration">{log.duration || 0}ms</span>
                    <details>
                        <summary>Details</summary>
                        <pre>{JSON.stringify({ params: log.params, result: log.result, error: log.error }, null, 2)}</pre>
                    </details>
                </div>
            {/each}
        </div>
    </div>
</div>

<style>
    .bridge-explorer {
        padding: 1rem;
        background: #1e1e1e;
        color: #d4d4d4;
        font-family: monospace;
        max-width: 800px;
        margin: 0 auto;
    }

    h2 {
        margin-bottom: 1rem;
        color: #569cd6;
    }

    .command-section {
        background: #252526;
        padding: 1rem;
        border-radius: 4px;
        margin-bottom: 1rem;
    }

    label {
        display: block;
        margin-bottom: 0.5rem;
    }

    select, input {
        width: 100%;
        padding: 0.5rem;
        background: #3c3c3c;
        border: 1px solid #444;
        color: #d4d4d4;
        border-radius: 4px;
        margin-top: 0.25rem;
    }

    .description {
        color: #808080;
        font-style: italic;
        margin: 0.5rem 0;
    }

    .params {
        margin: 1rem 0;
    }

    .execute-btn {
        background: #0e639c;
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
    }

    .execute-btn:hover:not(:disabled) {
        background: #1177bb;
    }

    .execute-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .result-section, .logs-section {
        background: #252526;
        padding: 1rem;
        border-radius: 4px;
        margin-bottom: 1rem;
    }

    h3 {
        color: #569cd6;
        margin-bottom: 0.5rem;
    }

    pre {
        background: #1e1e1e;
        padding: 0.5rem;
        border-radius: 4px;
        overflow-x: auto;
        margin: 0;
    }

    pre.error {
        border-left: 3px solid #f48771;
        color: #f48771;
    }

    pre.success {
        border-left: 3px solid #89d185;
        color: #89d185;
    }

    .logs {
        max-height: 300px;
        overflow-y: auto;
    }

    .log-entry {
        padding: 0.5rem;
        margin-bottom: 0.25rem;
        background: #1e1e1e;
        border-radius: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .log-entry.error {
        border-left: 3px solid #f48771;
    }

    .log-entry.success {
        border-left: 3px solid #89d185;
    }

    .command {
        font-weight: bold;
    }

    .duration {
        color: #808080;
        font-size: 0.9em;
    }

    details {
        margin-top: 0.5rem;
    }

    summary {
        cursor: pointer;
        color: #569cd6;
    }
</style>