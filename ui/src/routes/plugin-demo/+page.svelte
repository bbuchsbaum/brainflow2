<!-- Plugin System Demo Page -->
<script lang="ts">
	import { onMount } from 'svelte';

	let pluginTypes = [
		{
			type: 'loader',
			name: 'Loader Plugin',
			description: 'Load custom file formats into Brainflow',
			handles: ['Custom file formats', 'Data import', 'Format conversion'],
			examples: ['NIfTI loader', 'DICOM loader', 'CSV timeseries loader']
		},
		{
			type: 'visualization',
			name: 'Visualization Plugin',
			description: 'Create custom visualizations for neuroimaging data',
			handles: ['Timeseries plots', 'Volume slices', 'Connectivity matrices'],
			examples: ['Interactive timeseries', 'Heat maps', '3D surface plots']
		},
		{
			type: 'analysis',
			name: 'Analysis Plugin',
			description: 'Implement custom analysis algorithms',
			handles: ['Statistical analysis', 'Signal processing', 'Machine learning'],
			examples: ['GLM analysis', 'ICA decomposition', 'Connectivity analysis']
		},
		{
			type: 'ui',
			name: 'UI Plugin',
			description: 'Add custom UI components and panels',
			handles: ['Custom panels', 'Toolbars', 'Dialogs'],
			examples: ['Parameter panel', 'Results viewer', 'Settings dialog']
		},
		{
			type: 'workflow',
			name: 'Workflow Plugin',
			description: 'Create multi-step analysis workflows',
			handles: ['Processing pipelines', 'Batch operations', 'Automation'],
			examples: ['Preprocessing pipeline', 'Quality control', 'Reporting workflow']
		},
		{
			type: 'integration',
			name: 'Integration Plugin',
			description: 'Connect to external services and APIs',
			handles: ['Database connections', 'Cloud services', 'External APIs'],
			examples: ['XNAT integration', 'AWS S3 storage', 'NeuroVault upload']
		}
	];

	let selectedType = 'loader';
	let showCode = false;

	const selectType = (type: string) => {
		selectedType = type;
		showCode = false;
	};

	const toggleCode = () => {
		showCode = !showCode;
	};

	const getSelectedPlugin = () => {
		return pluginTypes.find((p) => p.type === selectedType) || pluginTypes[0];
	};

	const getTemplateCode = (type: string) => {
		const templates = {
			loader: `import { LoaderPlugin } from '@brainflow/plugin-sdk';

export class MyLoaderPlugin extends LoaderPlugin {
  canHandle(filePath: string): boolean {
    return filePath.endsWith('.myformat');
  }
  
  async load(filePath: string): Promise<VolumeHandle> {
    // Load file and return volume handle
    const data = await this.loadFile(filePath);
    return this.createVolumeHandle(data);
  }
}`,
			visualization: `import { VisualizationPlugin } from '@brainflow/plugin-sdk';

export class MyVisualizationPlugin extends VisualizationPlugin {
  getSupportedDataTypes(): string[] {
    return ['timeseries', 'connectivity-matrix'];
  }
  
  async render(element: HTMLElement, data: DataSample): Promise<void> {
    // Create visualization
    const canvas = this.createCanvas(element);
    this.renderData(canvas, data);
  }
}`,
			analysis: `import { AnalysisPlugin } from '@brainflow/plugin-sdk';

export class MyAnalysisPlugin extends AnalysisPlugin {
  getInputTypes(): string[] {
    return ['timeseries', 'volume'];
  }
  
  async process(input: any, options?: any): Promise<any> {
    // Perform analysis
    const result = await this.runAnalysis(input, options);
    return result;
  }
}`,
			ui: `import { UIPlugin } from '@brainflow/plugin-sdk';

export class MyUIPlugin extends UIPlugin {
  async createComponent(type: string, props?: any): Promise<any> {
    // Create UI component
    return this.createCustomComponent(type, props);
  }
}`,
			workflow: `import { WorkflowPlugin } from '@brainflow/plugin-sdk';

export class MyWorkflowPlugin extends WorkflowPlugin {
  getSteps() {
    return [
      { id: 'preprocess', name: 'Preprocessing' },
      { id: 'analyze', name: 'Analysis' },
      { id: 'visualize', name: 'Visualization' }
    ];
  }
  
  async execute(input: any, options?: any): Promise<any> {
    // Execute workflow steps
    return this.runWorkflow(input, options);
  }
}`,
			integration: `import { IntegrationPlugin } from '@brainflow/plugin-sdk';

export class MyIntegrationPlugin extends IntegrationPlugin {
  async connect(config: any): Promise<void> {
    // Connect to external service
    await this.establishConnection(config);
  }
  
  async disconnect(): Promise<void> {
    // Disconnect from service
    await this.closeConnection();
  }
}`
		};

		return templates[type as keyof typeof templates] || '// Template not found';
	};
</script>

<div class="container mx-auto max-w-6xl p-6">
	<h1 class="mb-6 text-3xl font-bold">Plugin System Demo</h1>

	<div class="mb-6">
		<p class="mb-4 text-gray-600">
			The Brainflow plugin system supports multiple types of plugins, each designed for specific use
			cases. Explore the different plugin types below to understand their capabilities.
		</p>
	</div>

	<!-- Plugin Type Selector -->
	<div class="mb-8">
		<h2 class="mb-4 text-xl font-semibold">Plugin Types</h2>
		<div class="grid grid-cols-2 gap-4 md:grid-cols-3">
			{#each pluginTypes as plugin}
				<button
					on:click={() => selectType(plugin.type)}
					class="rounded-lg border-2 p-4 text-left transition-colors {selectedType === plugin.type
						? 'border-blue-500 bg-blue-50'
						: 'border-gray-200 hover:border-gray-300'}"
				>
					<h3
						class="font-medium {selectedType === plugin.type ? 'text-blue-800' : 'text-gray-800'}"
					>
						{plugin.name}
					</h3>
					<p class="mt-1 text-sm text-gray-600">
						{plugin.description}
					</p>
				</button>
			{/each}
		</div>
	</div>

	<!-- Selected Plugin Details -->
	{#if selectedType}
		{@const plugin = getSelectedPlugin()}
		<div class="mb-6 rounded-lg border border-gray-200 bg-white p-6">
			<h2 class="mb-4 text-2xl font-semibold">{plugin.name}</h2>
			<p class="mb-4 text-gray-700">{plugin.description}</p>

			<div class="grid gap-6 md:grid-cols-2">
				<div>
					<h3 class="mb-3 font-medium">Handles</h3>
					<ul class="list-inside list-disc space-y-1 text-sm">
						{#each plugin.handles as handle}
							<li>{handle}</li>
						{/each}
					</ul>
				</div>

				<div>
					<h3 class="mb-3 font-medium">Examples</h3>
					<ul class="list-inside list-disc space-y-1 text-sm">
						{#each plugin.examples as example}
							<li>{example}</li>
						{/each}
					</ul>
				</div>
			</div>

			<div class="mt-6">
				<button
					on:click={toggleCode}
					class="rounded bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700"
				>
					{showCode ? 'Hide Code' : 'Show Template Code'}
				</button>
			</div>

			{#if showCode}
				<div class="mt-4 overflow-x-auto rounded-lg bg-gray-900 p-4">
					<pre class="text-sm text-gray-100"><code>{getTemplateCode(selectedType)}</code></pre>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Plugin Development Info -->
	<div class="mb-6 rounded-lg bg-blue-50 p-6">
		<h2 class="mb-4 text-xl font-semibold">Developing Plugins</h2>
		<div class="grid gap-6 md:grid-cols-2">
			<div>
				<h3 class="mb-3 font-medium">Getting Started</h3>
				<ol class="list-inside list-decimal space-y-1 text-sm">
					<li>
						Install the Plugin SDK: <code class="rounded bg-white px-2 py-1"
							>npm install @brainflow/plugin-sdk</code
						>
					</li>
					<li>Copy a template from the SDK</li>
					<li>Modify the manifest.json file</li>
					<li>Implement your plugin logic</li>
					<li>Build and test your plugin</li>
				</ol>
			</div>

			<div>
				<h3 class="mb-3 font-medium">Key Features</h3>
				<ul class="list-inside list-disc space-y-1 text-sm">
					<li>Type-safe TypeScript development</li>
					<li>Secure permission-based API access</li>
					<li>Resource management and monitoring</li>
					<li>Hot reloading for development</li>
					<li>Inter-plugin communication</li>
					<li>Built-in error handling</li>
				</ul>
			</div>
		</div>
	</div>

	<!-- Plugin System Architecture -->
	<div class="rounded-lg bg-gray-50 p-6">
		<h2 class="mb-4 text-xl font-semibold">Plugin System Architecture</h2>
		<div class="grid gap-4 md:grid-cols-3">
			<div class="rounded bg-white p-4">
				<h3 class="mb-2 font-medium">Core Components</h3>
				<ul class="space-y-1 text-sm">
					<li>Plugin Manager</li>
					<li>Plugin Registry</li>
					<li>Plugin Loader</li>
					<li>Plugin Validator</li>
				</ul>
			</div>

			<div class="rounded bg-white p-4">
				<h3 class="mb-2 font-medium">Communication</h3>
				<ul class="space-y-1 text-sm">
					<li>Message Bus</li>
					<li>Event System</li>
					<li>API Provider</li>
					<li>Resource Manager</li>
				</ul>
			</div>

			<div class="rounded bg-white p-4">
				<h3 class="mb-2 font-medium">Security & Performance</h3>
				<ul class="space-y-1 text-sm">
					<li>Permission System</li>
					<li>Resource Limits</li>
					<li>Performance Monitor</li>
					<li>Circuit Breaker</li>
				</ul>
			</div>
		</div>
	</div>
</div>

<style>
	.container {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	code {
		font-family: 'Courier New', monospace;
		font-size: 0.875rem;
	}
</style>
