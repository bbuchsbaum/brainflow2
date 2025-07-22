/**
 * Example Analysis Plugin
 * Demonstrates how to create an analysis plugin for Brainflow
 */

import { AnalysisPlugin, PluginSDK } from '@brainflow/plugin-sdk';
import type { PluginManifest, DataSample } from '@brainflow/plugin-sdk';

// Import the manifest
import manifest from '../manifest.json';

/**
 * My Custom Analysis Plugin
 * Performs statistical analysis on neuroimaging data
 */
export class MyAnalysisPlugin extends AnalysisPlugin {
  private currentProgress = 0;
  private isProcessing = false;

  constructor() {
    super(manifest as PluginManifest);
  }

  /**
   * Initialize the plugin
   */
  protected async onInitialize(): Promise<void> {
    this.log('info', 'MyAnalysisPlugin initialized');
    
    // Load any cached analysis results
    await this.loadCachedResults();
  }

  /**
   * Cleanup the plugin
   */
  protected async onCleanup(): Promise<void> {
    this.log('info', 'MyAnalysisPlugin cleaned up');
    
    // Save any pending results
    await this.saveCachedResults();
  }

  /**
   * Get supported input data types
   */
  getInputTypes(): string[] {
    return ['timeseries', 'volume', 'statistical-map'];
  }

  /**
   * Get output data types
   */
  getOutputTypes(): string[] {
    return ['statistical-map', 'connectivity-matrix', 'summary-statistics'];
  }

  /**
   * Process input data and return results
   */
  async process(input: AnalysisInput, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    try {
      this.log('info', `Starting analysis of ${input.type} data`);
      this.isProcessing = true;
      this.currentProgress = 0;

      // Emit processing started event
      await this.emitEvent('plugin.analysis.started', {
        pluginId: this.getManifest().id,
        inputType: input.type,
        options
      });

      // Validate input
      const validation = await this.validate(input);
      if (!validation.valid) {
        throw new Error(`Input validation failed: ${validation.errors?.join(', ')}`);
      }

      // Allocate memory for processing
      const context = this.getContext();
      const memoryBlock = context.resources.allocateMemory(options.maxMemoryMB || 256);
      if (!memoryBlock) {
        throw new Error('Failed to allocate memory for analysis');
      }

      let result: AnalysisResult;

      try {
        // Process based on input type
        switch (input.type) {
          case 'timeseries':
            result = await this.processTimeSeries(input, options);
            break;
          case 'volume':
            result = await this.processVolume(input, options);
            break;
          case 'statistical-map':
            result = await this.processStatisticalMap(input, options);
            break;
          default:
            throw new Error(`Unsupported input type: ${input.type}`);
        }

        // Cache results if requested
        if (options.cacheResults) {
          await this.cacheResult(input, result);
        }

        // Emit completion event
        await this.emitEvent('plugin.analysis.completed', {
          pluginId: this.getManifest().id,
          inputType: input.type,
          resultType: result.type,
          duration: result.processingTime
        });

        this.log('info', `Analysis completed in ${result.processingTime}ms`);
        this.showNotification('success', 'Analysis completed successfully');

        return result;

      } finally {
        // Always clean up memory
        context.resources.releaseMemory(memoryBlock);
        this.isProcessing = false;
        this.currentProgress = 0;
      }

    } catch (error) {
      this.isProcessing = false;
      this.currentProgress = 0;
      
      this.log('error', 'Analysis failed', error);
      this.showNotification('error', `Analysis failed: ${(error as Error).message}`);
      
      // Emit error event
      await this.emitEvent('plugin.analysis.error', {
        pluginId: this.getManifest().id,
        error: (error as Error).message
      });

      throw error;
    }
  }

  /**
   * Validate input data
   */
  async validate(input: AnalysisInput): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    // Check input type
    if (!this.getInputTypes().includes(input.type)) {
      errors.push(`Unsupported input type: ${input.type}`);
    }

    // Check data presence
    if (!input.data) {
      errors.push('Input data is required');
    }

    // Type-specific validation
    switch (input.type) {
      case 'timeseries':
        if (!(input.data instanceof Float32Array) && !Array.isArray(input.data)) {
          errors.push('Timeseries data must be Float32Array or number array');
        }
        break;
        
      case 'volume':
        if (!input.metadata?.dimensions) {
          errors.push('Volume data must include dimensions metadata');
        }
        break;
        
      case 'statistical-map':
        if (!input.metadata?.threshold) {
          errors.push('Statistical map must include threshold metadata');
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Get processing progress (0-1)
   */
  getProgress(): number {
    return this.currentProgress;
  }

  // Private processing methods

  private async processTimeSeries(
    input: AnalysisInput, 
    options: AnalysisOptions
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const data = input.data as Float32Array | number[];
    
    this.log('info', `Processing timeseries with ${data.length} timepoints`);

    // Step 1: Basic statistics
    this.currentProgress = 0.2;
    const mean = this.calculateMean(data);
    const std = this.calculateStandardDeviation(data, mean);
    const trend = this.calculateTrend(data);

    // Step 2: Frequency analysis
    this.currentProgress = 0.5;
    const powerSpectrum = await this.calculatePowerSpectrum(data);

    // Step 3: Connectivity analysis (if multiple series)
    this.currentProgress = 0.8;
    let connectivity: number[][] | undefined;
    if (options.includeConnectivity && input.metadata?.multiSeries) {
      connectivity = await this.calculateConnectivity(input.metadata.multiSeries);
    }

    this.currentProgress = 1.0;

    return {
      type: 'summary-statistics',
      data: {
        statistics: { mean, std, trend },
        powerSpectrum,
        connectivity
      },
      metadata: {
        inputLength: data.length,
        samplingRate: input.metadata?.samplingRate || 1.0,
        analysisType: 'timeseries'
      },
      processingTime: Date.now() - startTime
    };
  }

  private async processVolume(
    input: AnalysisInput, 
    options: AnalysisOptions
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const data = input.data as ArrayBuffer;
    const dimensions = input.metadata?.dimensions as [number, number, number];
    
    this.log('info', `Processing volume with dimensions ${dimensions.join('x')}`);

    // Step 1: Basic volume statistics
    this.currentProgress = 0.3;
    const volumeStats = await this.calculateVolumeStatistics(data, dimensions);

    // Step 2: Generate statistical map
    this.currentProgress = 0.7;
    const statisticalMap = await this.generateStatisticalMap(data, dimensions, options);

    this.currentProgress = 1.0;

    return {
      type: 'statistical-map',
      data: statisticalMap,
      metadata: {
        dimensions,
        statistics: volumeStats,
        threshold: options.threshold || 0.05,
        analysisType: 'volume'
      },
      processingTime: Date.now() - startTime
    };
  }

  private async processStatisticalMap(
    input: AnalysisInput, 
    options: AnalysisOptions
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const data = input.data as Float32Array;
    
    this.log('info', 'Processing statistical map');

    // Step 1: Apply thresholding
    this.currentProgress = 0.4;
    const threshold = options.threshold || input.metadata?.threshold || 0.05;
    const thresholdedMap = this.applyThreshold(data, threshold);

    // Step 2: Cluster analysis
    this.currentProgress = 0.8;
    const clusters = await this.findClusters(thresholdedMap, options.clusterSize || 10);

    this.currentProgress = 1.0;

    return {
      type: 'statistical-map',
      data: thresholdedMap,
      metadata: {
        threshold,
        clusters,
        originalSize: data.length,
        analysisType: 'statistical-thresholding'
      },
      processingTime: Date.now() - startTime
    };
  }

  // Statistical calculation methods

  private calculateMean(data: Float32Array | number[]): number {
    const sum = Array.from(data).reduce((acc, val) => acc + val, 0);
    return sum / data.length;
  }

  private calculateStandardDeviation(data: Float32Array | number[], mean: number): number {
    const squaredDiffs = Array.from(data).map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / data.length;
    return Math.sqrt(variance);
  }

  private calculateTrend(data: Float32Array | number[]): number {
    // Simple linear trend calculation
    const n = data.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = Array.from(data);
    
    const sumX = x.reduce((acc, val) => acc + val, 0);
    const sumY = y.reduce((acc, val) => acc + val, 0);
    const sumXY = x.reduce((acc, val, i) => acc + val * y[i], 0);
    const sumXX = x.reduce((acc, val) => acc + val * val, 0);
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }

  private async calculatePowerSpectrum(data: Float32Array | number[]): Promise<number[]> {
    // Simplified power spectrum calculation
    // In a real implementation, you'd use FFT
    const spectrum: number[] = [];
    const windowSize = Math.min(64, Math.floor(data.length / 4));
    
    for (let i = 0; i < windowSize; i++) {
      let power = 0;
      for (let j = 0; j < data.length - i; j++) {
        power += Math.abs(data[j] * data[j + i]);
      }
      spectrum.push(power / (data.length - i));
    }
    
    return spectrum;
  }

  private async calculateConnectivity(multiSeries: number[][]): Promise<number[][]> {
    // Calculate correlation matrix between time series
    const n = multiSeries.length;
    const connectivity: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const correlation = this.calculateCorrelation(multiSeries[i], multiSeries[j]);
        connectivity[i][j] = correlation;
        connectivity[j][i] = correlation;
      }
    }
    
    return connectivity;
  }

  private calculateCorrelation(series1: number[], series2: number[]): number {
    const mean1 = this.calculateMean(series1);
    const mean2 = this.calculateMean(series2);
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < series1.length; i++) {
      const diff1 = series1[i] - mean1;
      const diff2 = series2[i] - mean2;
      
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    return numerator / Math.sqrt(denominator1 * denominator2);
  }

  private async calculateVolumeStatistics(
    data: ArrayBuffer, 
    dimensions: [number, number, number]
  ): Promise<VolumeStatistics> {
    // Convert ArrayBuffer to typed array (assuming float32)
    const values = new Float32Array(data);
    
    const mean = this.calculateMean(values);
    const std = this.calculateStandardDeviation(values, mean);
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    return { mean, std, min, max, voxelCount: values.length };
  }

  private async generateStatisticalMap(
    data: ArrayBuffer,
    dimensions: [number, number, number],
    options: AnalysisOptions
  ): Promise<Float32Array> {
    // Simplified statistical map generation
    // In reality, this would involve complex statistical calculations
    const values = new Float32Array(data);
    const result = new Float32Array(values.length);
    
    const mean = this.calculateMean(values);
    const std = this.calculateStandardDeviation(values, mean);
    
    // Generate z-scores
    for (let i = 0; i < values.length; i++) {
      result[i] = (values[i] - mean) / std;
    }
    
    return result;
  }

  private applyThreshold(data: Float32Array, threshold: number): Float32Array {
    const result = new Float32Array(data.length);
    
    for (let i = 0; i < data.length; i++) {
      result[i] = Math.abs(data[i]) > threshold ? data[i] : 0;
    }
    
    return result;
  }

  private async findClusters(data: Float32Array, minSize: number): Promise<Cluster[]> {
    // Simplified cluster finding
    const clusters: Cluster[] = [];
    const visited = new Set<number>();
    
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0 && !visited.has(i)) {
        const cluster = this.growCluster(data, i, visited);
        if (cluster.size >= minSize) {
          clusters.push({
            size: cluster.size,
            maxValue: Math.max(...cluster.voxels.map(v => Math.abs(data[v]))),
            voxels: cluster.voxels
          });
        }
      }
    }
    
    return clusters;
  }

  private growCluster(data: Float32Array, startIndex: number, visited: Set<number>): {
    size: number;
    voxels: number[];
  } {
    // Simplified cluster growing (assuming 1D for simplicity)
    const voxels: number[] = [];
    const queue = [startIndex];
    
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      
      visited.add(current);
      voxels.push(current);
      
      // Check neighbors (simplified 1D neighbors)
      for (const neighbor of [current - 1, current + 1]) {
        if (neighbor >= 0 && neighbor < data.length && 
            data[neighbor] !== 0 && !visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    
    return { size: voxels.length, voxels };
  }

  // Caching methods

  private async loadCachedResults(): Promise<void> {
    try {
      const context = this.getContext();
      const cached = await context.api.storage.get('analysisCache');
      if (cached) {
        this.log('info', 'Loaded cached analysis results');
      }
    } catch (error) {
      this.log('warn', 'Failed to load cached results', error);
    }
  }

  private async saveCachedResults(): Promise<void> {
    try {
      const context = this.getContext();
      await context.api.storage.set('analysisCache', {
        lastSaved: new Date().toISOString()
      });
    } catch (error) {
      this.log('warn', 'Failed to save cached results', error);
    }
  }

  private async cacheResult(input: AnalysisInput, result: AnalysisResult): Promise<void> {
    try {
      const context = this.getContext();
      const cacheKey = this.generateCacheKey(input);
      await context.api.storage.set(cacheKey, result);
      this.log('debug', `Cached result with key: ${cacheKey}`);
    } catch (error) {
      this.log('warn', 'Failed to cache result', error);
    }
  }

  private generateCacheKey(input: AnalysisInput): string {
    // Generate a cache key based on input characteristics
    const hash = this.simpleHash(JSON.stringify({
      type: input.type,
      dataLength: input.data?.length || 0,
      metadata: input.metadata
    }));
    return `analysis_${hash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

// Types
interface AnalysisInput {
  type: 'timeseries' | 'volume' | 'statistical-map';
  data: Float32Array | number[] | ArrayBuffer;
  metadata?: {
    dimensions?: [number, number, number];
    samplingRate?: number;
    threshold?: number;
    multiSeries?: number[][];
    [key: string]: any;
  };
}

interface AnalysisOptions {
  threshold?: number;
  clusterSize?: number;
  includeConnectivity?: boolean;
  cacheResults?: boolean;
  maxMemoryMB?: number;
}

interface AnalysisResult {
  type: 'statistical-map' | 'connectivity-matrix' | 'summary-statistics';
  data: any;
  metadata: {
    [key: string]: any;
  };
  processingTime: number;
}

interface VolumeStatistics {
  mean: number;
  std: number;
  min: number;
  max: number;
  voxelCount: number;
}

interface Cluster {
  size: number;
  maxValue: number;
  voxels: number[];
}

// Export the plugin class as default
export default MyAnalysisPlugin;

// Validate the plugin structure
const validation = PluginSDK.validatePlugin(new MyAnalysisPlugin(), 'analysis');
if (!validation.valid) {
  console.error('Plugin validation failed:', validation.errors);
}