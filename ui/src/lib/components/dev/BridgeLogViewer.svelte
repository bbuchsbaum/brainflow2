<script lang="ts">
  import { bridgeLogs, errorLogs, slowCommands, bridgeLogger } from '$lib/utils/bridgeLogger';
  import type { BridgeLogEntry } from '$lib/utils/bridgeLogger';
  
  let filter: 'all' | 'errors' | 'slow' = 'all';
  let selectedLog: BridgeLogEntry | null = null;
  let loggingEnabled = bridgeLogger.isEnabled();
  
  $: filteredLogs = filter === 'all' ? $bridgeLogs 
                  : filter === 'errors' ? $errorLogs
                  : $slowCommands;
  
  function toggleLogging() {
    loggingEnabled = !loggingEnabled;
    bridgeLogger.setEnabled(loggingEnabled);
  }
  
  function clearLogs() {
    bridgeLogger.clear();
    selectedLog = null;
  }
  
  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 3 
    });
  }
  
  function formatDuration(duration?: number): string {
    if (!duration) return '-';
    return `${duration.toFixed(2)}ms`;
  }
  
  function getStatusIcon(status: string): string {
    switch (status) {
      case 'pending': return '⏳';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '❓';
    }
  }
  
  function getStatusColor(status: string): string {
    switch (status) {
      case 'pending': return 'text-yellow-500';
      case 'success': return 'text-green-500';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  }
</script>

<div class="bridge-log-viewer p-4 bg-gray-900 text-white h-full overflow-hidden flex flex-col">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-xl font-bold">📡 Bridge Log Viewer</h2>
    <div class="flex items-center gap-2">
      <button
        class="px-3 py-1 text-sm rounded {loggingEnabled ? 'bg-green-600' : 'bg-gray-600'}"
        on:click={toggleLogging}
      >
        {loggingEnabled ? '🔴 Logging ON' : '⚪ Logging OFF'}
      </button>
      <button
        class="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded"
        on:click={clearLogs}
      >
        🗑️ Clear
      </button>
    </div>
  </div>
  
  <!-- Filter Tabs -->
  <div class="flex gap-2 mb-4">
    <button
      class="px-3 py-1 text-sm rounded {filter === 'all' ? 'bg-blue-600' : 'bg-gray-700'}"
      on:click={() => filter = 'all'}
    >
      All ({$bridgeLogs.length})
    </button>
    <button
      class="px-3 py-1 text-sm rounded {filter === 'errors' ? 'bg-red-600' : 'bg-gray-700'}"
      on:click={() => filter = 'errors'}
    >
      Errors ({$errorLogs.length})
    </button>
    <button
      class="px-3 py-1 text-sm rounded {filter === 'slow' ? 'bg-yellow-600' : 'bg-gray-700'}"
      on:click={() => filter = 'slow'}
    >
      Slow >100ms ({$slowCommands.length})
    </button>
  </div>
  
  <div class="flex gap-4 flex-1 overflow-hidden">
    <!-- Log List -->
    <div class="w-1/2 overflow-y-auto">
      {#if filteredLogs.length === 0}
        <div class="text-center text-gray-500 mt-8">
          {loggingEnabled ? 'No logs yet. Execute some commands!' : 'Logging is disabled'}
        </div>
      {:else}
        <div class="space-y-1">
          {#each filteredLogs as log}
            <button
              class="w-full text-left p-2 rounded hover:bg-gray-800 transition-colors
                     {selectedLog?.id === log.id ? 'bg-gray-800 border-l-2 border-blue-500' : ''}"
              on:click={() => selectedLog = log}
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class={getStatusColor(log.status)}>{getStatusIcon(log.status)}</span>
                  <span class="font-mono text-sm text-blue-400">{log.command}</span>
                </div>
                <div class="flex items-center gap-2 text-xs text-gray-500">
                  <span>{formatDuration(log.duration)}</span>
                  <span>{formatTimestamp(log.timestamp)}</span>
                </div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    
    <!-- Log Details -->
    <div class="flex-1 overflow-y-auto">
      {#if selectedLog}
        <div class="space-y-4">
          <div>
            <h3 class="text-lg font-semibold mb-2">{selectedLog.command}</h3>
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div>Status: <span class={getStatusColor(selectedLog.status)}>{selectedLog.status}</span></div>
              <div>Duration: {formatDuration(selectedLog.duration)}</div>
              <div>Time: {formatTimestamp(selectedLog.timestamp)}</div>
              <div>ID: <span class="font-mono text-xs">{selectedLog.id}</span></div>
            </div>
          </div>
          
          {#if selectedLog.params}
            <div>
              <h4 class="text-sm font-semibold mb-1">Parameters:</h4>
              <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">{JSON.stringify(selectedLog.params, null, 2)}</pre>
            </div>
          {/if}
          
          {#if selectedLog.result !== undefined}
            <div>
              <h4 class="text-sm font-semibold mb-1 text-green-400">Result:</h4>
              <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">{JSON.stringify(selectedLog.result, null, 2)}</pre>
            </div>
          {/if}
          
          {#if selectedLog.error}
            <div>
              <h4 class="text-sm font-semibold mb-1 text-red-400">Error:</h4>
              <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">{JSON.stringify(selectedLog.error, null, 2)}</pre>
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex items-center justify-center h-full text-gray-500">
          Select a log entry to view details
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .bridge-log-viewer {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace;
  }
  
  pre {
    font-family: inherit;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>