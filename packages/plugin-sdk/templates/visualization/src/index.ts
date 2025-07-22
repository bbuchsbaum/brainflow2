/**
 * Example Visualization Plugin
 * Demonstrates how to create a visualization plugin for Brainflow
 */

import { VisualizationPlugin, PluginSDK } from '@brainflow/plugin-sdk';
import type { PluginManifest, DataSample } from '@brainflow/plugin-sdk';

// Import the manifest
import manifest from '../manifest.json';

/**
 * My Custom Visualization Plugin
 * Creates interactive visualizations for neuroimaging data
 */
export class MyVisualizationPlugin extends VisualizationPlugin {
  private currentVisualization?: {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D | WebGLRenderingContext;
    data: any;
    options: any;
  };
  
  private animationFrame?: number;

  constructor() {
    super(manifest as PluginManifest);
  }

  /**
   * Initialize the plugin
   */
  protected async onInitialize(): Promise<void> {
    this.log('info', 'MyVisualizationPlugin initialized');
    
    // Subscribe to relevant events
    this.subscribeEvent('volume.loaded', this.onVolumeLoaded.bind(this));
    this.subscribeEvent('crosshair.changed', this.onCrosshairChanged.bind(this));
  }

  /**
   * Cleanup the plugin
   */
  protected async onCleanup(): Promise<void> {
    this.log('info', 'MyVisualizationPlugin cleaned up');
    
    // Cancel any ongoing animations
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    
    // Dispose of current visualization
    await this.dispose();
  }

  /**
   * Get supported data types
   */
  getSupportedDataTypes(): string[] {
    return ['timeseries', 'volume-slice', 'connectivity-matrix'];
  }

  /**
   * Render data to the target element
   */
  async render(
    targetElement: HTMLElement | OffscreenCanvas, 
    data: DataSample, 
    options: VisualizationOptions = {}
  ): Promise<void> {
    try {
      this.log('info', `Rendering ${data.type} data`);

      // Dispose of previous visualization
      await this.dispose();

      // Create or get canvas
      const canvas = await this.setupCanvas(targetElement);
      
      // Render based on data type
      switch (data.type) {
        case 'timeseries':
          await this.renderTimeSeries(canvas, data, options);
          break;
        case 'volume-slice':
          await this.renderVolumeSlice(canvas, data, options);
          break;
        case 'connectivity-matrix':
          await this.renderConnectivityMatrix(canvas, data, options);
          break;
        default:
          throw new Error(`Unsupported data type: ${data.type}`);
      }

      // Store current visualization
      this.currentVisualization = {
        canvas,
        context: canvas.getContext('2d') || canvas.getContext('webgl')!,
        data,
        options
      };

      this.log('info', 'Rendering completed successfully');

    } catch (error) {
      this.log('error', 'Rendering failed', error);
      this.showNotification('error', `Visualization failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Resize the visualization
   */
  async resize(width: number, height: number): Promise<void> {
    if (!this.currentVisualization) {
      return;
    }

    const { canvas, data, options } = this.currentVisualization;
    
    // Update canvas size
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Re-render with new size
    await this.render(canvas, data, options);
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }

    if (this.currentVisualization) {
      // Clean up WebGL resources if applicable
      const context = this.currentVisualization.context;
      if (context instanceof WebGLRenderingContext) {
        // Clean up WebGL resources
        const ext = context.getExtension('WEBGL_lose_context');
        if (ext) {
          ext.loseContext();
        }
      }

      this.currentVisualization = undefined;
    }
  }

  /**
   * Get visualization options schema
   */
  getOptions() {
    return {
      colormap: {
        type: 'string',
        default: 'viridis',
        options: ['viridis', 'plasma', 'magma', 'inferno', 'grayscale']
      },
      showGrid: {
        type: 'boolean',
        default: true
      },
      lineWidth: {
        type: 'number',
        default: 2,
        min: 1,
        max: 10
      },
      opacity: {
        type: 'number',
        default: 1.0,
        min: 0.0,
        max: 1.0
      },
      animationSpeed: {
        type: 'number',
        default: 1.0,
        min: 0.1,
        max: 5.0
      }
    };
  }

  /**
   * Set visualization options
   */
  async setOptions(options: VisualizationOptions): Promise<void> {
    if (this.currentVisualization) {
      // Update options and re-render
      this.currentVisualization.options = { ...this.currentVisualization.options, ...options };
      await this.render(
        this.currentVisualization.canvas,
        this.currentVisualization.data,
        this.currentVisualization.options
      );
    }
  }

  // Private rendering methods

  private async setupCanvas(targetElement: HTMLElement | OffscreenCanvas): Promise<HTMLCanvasElement> {
    if (targetElement instanceof OffscreenCanvas) {
      // For offscreen rendering
      return targetElement as any;
    }

    // Create or reuse canvas element
    let canvas = targetElement.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      targetElement.appendChild(canvas);
    }

    // Set canvas size to match container
    const rect = targetElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    return canvas;
  }

  private async renderTimeSeries(
    canvas: HTMLCanvasElement, 
    data: DataSample, 
    options: VisualizationOptions
  ): Promise<void> {
    const ctx = canvas.getContext('2d')!;
    const timeSeriesData = data.data as Float32Array;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Set up drawing context
    ctx.strokeStyle = options.color || '#007acc';
    ctx.lineWidth = options.lineWidth || 2;
    ctx.globalAlpha = options.opacity || 1.0;

    // Draw grid if enabled
    if (options.showGrid) {
      this.drawGrid(ctx, canvas.width, canvas.height);
    }

    // Draw time series
    ctx.beginPath();
    const stepX = canvas.width / timeSeriesData.length;
    let minVal = Math.min(...timeSeriesData);
    let maxVal = Math.max(...timeSeriesData);
    const range = maxVal - minVal;

    for (let i = 0; i < timeSeriesData.length; i++) {
      const x = i * stepX;
      const y = canvas.height - ((timeSeriesData[i] - minVal) / range) * canvas.height;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();

    // Add labels
    this.drawLabels(ctx, canvas, { minVal, maxVal, dataLength: timeSeriesData.length });
  }

  private async renderVolumeSlice(
    canvas: HTMLCanvasElement, 
    data: DataSample, 
    options: VisualizationOptions
  ): Promise<void> {
    // Use WebGL for volume slice rendering
    const gl = canvas.getContext('webgl')!;
    if (!gl) {
      throw new Error('WebGL not supported');
    }

    // Set up WebGL context
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Implementation would involve:
    // 1. Creating shaders for volume rendering
    // 2. Setting up texture with volume data
    // 3. Applying colormap
    // 4. Rendering the slice

    this.log('info', 'Volume slice rendering (WebGL implementation needed)');
  }

  private async renderConnectivityMatrix(
    canvas: HTMLCanvasElement, 
    data: DataSample, 
    options: VisualizationOptions
  ): Promise<void> {
    const ctx = canvas.getContext('2d')!;
    const matrix = data.data as number[][];
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cellWidth = canvas.width / matrix.length;
    const cellHeight = canvas.height / matrix[0].length;
    
    // Find min/max for color scaling
    let minVal = Infinity;
    let maxVal = -Infinity;
    
    for (const row of matrix) {
      for (const value of row) {
        minVal = Math.min(minVal, value);
        maxVal = Math.max(maxVal, value);
      }
    }
    
    const range = maxVal - minVal;
    
    // Draw matrix
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const value = matrix[i][j];
        const intensity = (value - minVal) / range;
        
        // Apply colormap
        const color = this.applyColormap(intensity, options.colormap || 'viridis');
        ctx.fillStyle = color;
        
        ctx.fillRect(
          i * cellWidth,
          j * cellHeight,
          cellWidth,
          cellHeight
        );
      }
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;

    // Vertical lines
    for (let x = 0; x <= width; x += width / 10) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= height; y += height / 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D, 
    canvas: HTMLCanvasElement, 
    info: { minVal: number; maxVal: number; dataLength: number }
  ): void {
    ctx.save();
    ctx.fillStyle = '#333';
    ctx.font = '12px Arial';

    // Y-axis labels
    ctx.fillText(info.maxVal.toFixed(2), 5, 15);
    ctx.fillText(info.minVal.toFixed(2), 5, canvas.height - 5);
    
    // X-axis labels
    ctx.fillText('0', 5, canvas.height - 20);
    ctx.fillText(info.dataLength.toString(), canvas.width - 30, canvas.height - 20);

    ctx.restore();
  }

  private applyColormap(value: number, colormap: string): string {
    // Simple colormap implementation
    switch (colormap) {
      case 'viridis':
        return `hsl(${240 + value * 120}, 50%, ${30 + value * 40}%)`;
      case 'plasma':
        return `hsl(${280 + value * 80}, 70%, ${20 + value * 60}%)`;
      case 'grayscale':
        const gray = Math.floor(value * 255);
        return `rgb(${gray}, ${gray}, ${gray})`;
      default:
        return `hsl(${value * 360}, 50%, 50%)`;
    }
  }

  // Event handlers

  private onVolumeLoaded(payload: any): void {
    this.log('info', 'Volume loaded, updating visualization if relevant');
    // Update visualization if it depends on volume data
  }

  private onCrosshairChanged(payload: any): void {
    this.log('debug', 'Crosshair changed', payload);
    // Update visualization if it shows crosshair position
  }
}

// Types
interface VisualizationOptions {
  colormap?: string;
  showGrid?: boolean;
  lineWidth?: number;
  opacity?: number;
  animationSpeed?: number;
  color?: string;
}

// Export the plugin class as default
export default MyVisualizationPlugin;

// Validate the plugin structure
const validation = PluginSDK.validatePlugin(new MyVisualizationPlugin(), 'visualization');
if (!validation.valid) {
  console.error('Plugin validation failed:', validation.errors);
}