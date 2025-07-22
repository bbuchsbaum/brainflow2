<!--
  Time Series Plot Component
  Renders time series data using D3.js with interactive features
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as d3 from 'd3';
	import type { PlotDataSeries, PlotDataPoint, PlotInteraction } from '../PlotProvider';
	import type { TimeSeriesConfig } from './TimeSeriesPlotProvider';

	// Props
	let {
		series = [],
		config = {},
		onInteraction = () => {}
	}: {
		series?: PlotDataSeries[];
		config?: TimeSeriesConfig;
		onInteraction?: (interaction: PlotInteraction) => void;
	} = $props();

	// State
	let container: HTMLDivElement;
	let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
	let chart: TimeSeriesChart | null = null;

	// Lifecycle
	onMount(() => {
		if (container) {
			chart = new TimeSeriesChart(container, config, onInteraction);
			chart.render(series);
		}

		return () => {
			chart?.destroy();
		};
	});

	// API methods for provider
	export function appendData(seriesId: string, data: PlotDataPoint | PlotDataPoint[]) {
		chart?.appendData(seriesId, data);
	}

	export function replaceData(seriesId: string, data: PlotDataPoint | PlotDataPoint[]) {
		chart?.replaceData(seriesId, data);
	}

	export function updateRange(
		seriesId: string,
		data: PlotDataPoint | PlotDataPoint[],
		range: { start: number; end: number }
	) {
		chart?.updateRange(seriesId, data, range);
	}

	export function getSeries(): PlotDataSeries[] {
		return series;
	}

	export async function exportImage(format: 'png' | 'svg'): Promise<Blob> {
		if (!chart) throw new Error('Chart not initialized');
		return chart.exportImage(format);
	}

	// Reactive updates
	$effect(() => {
		if (chart && series) {
			chart.render(series);
		}
	});

	$effect(() => {
		if (chart && config) {
			chart.updateConfig(config);
		}
	});

	// Time Series Chart Class
	class TimeSeriesChart {
		private container: HTMLDivElement;
		private config: TimeSeriesConfig;
		private onInteraction: (interaction: PlotInteraction) => void;
		private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
		private g: d3.Selection<SVGGElement, unknown, null, undefined>;
		private xScale: d3.ScaleLinear<number, number> | d3.ScaleTime<number, number>;
		private yScale: d3.ScaleLinear<number, number> | d3.ScaleLogarithmic<number, number>;
		private xAxis: d3.Axis<number | Date>;
		private yAxis: d3.Axis<number>;
		private line: d3.Line<PlotDataPoint>;
		private area: d3.Area<PlotDataPoint>;
		private zoom: d3.ZoomBehavior<Element, unknown>;
		private tooltip: d3.Selection<HTMLDivElement, unknown, null, undefined>;
		private width: number;
		private height: number;
		private margin: { top: number; right: number; bottom: number; left: number };

		constructor(
			container: HTMLDivElement,
			config: TimeSeriesConfig,
			onInteraction: (interaction: PlotInteraction) => void
		) {
			this.container = container;
			this.config = config;
			this.onInteraction = onInteraction;

			this.margin = config.margin || { top: 20, right: 20, bottom: 40, left: 60 };
			this.width = (config.width || 600) - this.margin.left - this.margin.right;
			this.height = (config.height || 400) - this.margin.top - this.margin.bottom;

			this.initChart();
		}

		private initChart() {
			// Create SVG
			this.svg = d3
				.select(this.container)
				.append('svg')
				.attr('width', this.width + this.margin.left + this.margin.right)
				.attr('height', this.height + this.margin.top + this.margin.bottom);

			// Create main group
			this.g = this.svg
				.append('g')
				.attr('transform', `translate(${this.margin.left},${this.margin.top})`);

			// Create scales
			this.xScale =
				this.config.xAxis?.type === 'time'
					? d3.scaleTime().range([0, this.width])
					: d3.scaleLinear().range([0, this.width]);

			this.yScale =
				this.config.yAxis?.scale === 'log'
					? d3.scaleLog().range([this.height, 0])
					: d3.scaleLinear().range([this.height, 0]);

			// Create axes
			this.xAxis = d3.axisBottom(this.xScale as any);
			this.yAxis = d3.axisLeft(this.yScale);

			// Add axes groups
			this.g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${this.height})`);

			this.g.append('g').attr('class', 'y-axis');

			// Add axis labels
			if (this.config.xAxis?.label) {
				this.g
					.append('text')
					.attr('class', 'x-label')
					.attr('text-anchor', 'middle')
					.attr('x', this.width / 2)
					.attr('y', this.height + this.margin.bottom)
					.text(this.config.xAxis.label);
			}

			if (this.config.yAxis?.label) {
				this.g
					.append('text')
					.attr('class', 'y-label')
					.attr('text-anchor', 'middle')
					.attr('transform', 'rotate(-90)')
					.attr('y', -this.margin.left + 15)
					.attr('x', -this.height / 2)
					.text(this.config.yAxis.label);
			}

			// Add grid
			if (this.config.showGrid) {
				this.g
					.append('g')
					.attr('class', 'grid x-grid')
					.attr('transform', `translate(0,${this.height})`);

				this.g.append('g').attr('class', 'grid y-grid');
			}

			// Create line generator
			this.line = d3
				.line<PlotDataPoint>()
				.x((d) => this.xScale(d.x) as number)
				.y((d) => this.yScale(d.y) as number);

			if (this.config.interpolation === 'step') {
				this.line.curve(d3.curveStep);
			} else if (this.config.interpolation === 'smooth') {
				this.line.curve(d3.curveCatmullRom);
			}

			// Create area generator for area charts
			this.area = d3
				.area<PlotDataPoint>()
				.x((d) => this.xScale(d.x) as number)
				.y0((d) => this.yScale(d.metadata?.yMin || 0) as number)
				.y1((d) => this.yScale(d.metadata?.yMax || d.y) as number);

			// Add zoom behavior
			if (this.config.interactive) {
				this.zoom = d3
					.zoom()
					.scaleExtent([1, 10])
					.translateExtent([
						[0, 0],
						[this.width, this.height]
					])
					.extent([
						[0, 0],
						[this.width, this.height]
					])
					.on('zoom', this.zoomed.bind(this));

				this.svg.call(this.zoom as any);
			}

			// Create tooltip
			this.tooltip = d3
				.select(this.container)
				.append('div')
				.attr('class', 'plot-tooltip')
				.style('opacity', 0)
				.style('position', 'absolute')
				.style('background', 'rgba(0, 0, 0, 0.8)')
				.style('color', 'white')
				.style('border-radius', '4px')
				.style('padding', '8px')
				.style('font-size', '12px')
				.style('pointer-events', 'none');

			// Add CSS styles
			this.addStyles();
		}

		render(series: PlotDataSeries[]) {
			// Update scales domain
			const allData = series.flatMap((s) => s.data);

			this.xScale.domain(d3.extent(allData, (d) => d.x) as [number, number]);

			const yExtent = d3.extent(allData, (d) => d.y) as [number, number];
			if (this.config.yAxis?.min !== undefined) yExtent[0] = this.config.yAxis.min;
			if (this.config.yAxis?.max !== undefined) yExtent[1] = this.config.yAxis.max;
			this.yScale.domain(yExtent);

			// Update axes
			this.g.select('.x-axis').call(this.xAxis as any);
			this.g.select('.y-axis').call(this.yAxis as any);

			// Update grid
			if (this.config.showGrid) {
				this.g.select('.x-grid').call(
					d3
						.axisBottom(this.xScale)
						.tickSize(-this.height)
						.tickFormat(() => '') as any
				);

				this.g.select('.y-grid').call(
					d3
						.axisLeft(this.yScale)
						.tickSize(-this.width)
						.tickFormat(() => '') as any
				);
			}

			// Render series
			const seriesGroups = this.g.selectAll('.series').data(series, (d: any) => d.id);

			// Remove old series
			seriesGroups.exit().remove();

			// Add new series
			const seriesEnter = seriesGroups.enter().append('g').attr('class', 'series');

			// Merge enter and update
			const seriesMerge = seriesEnter.merge(seriesGroups as any);

			// Update each series
			seriesMerge.each((seriesData: PlotDataSeries, i, nodes) => {
				const seriesGroup = d3.select(nodes[i]);

				// Clear previous content
				seriesGroup.selectAll('*').remove();

				if (!seriesData.visible) return;

				// Render based on type
				if (seriesData.type === 'area') {
					seriesGroup
						.append('path')
						.datum(seriesData.data)
						.attr('class', 'area')
						.attr('fill', seriesData.color || '#3b82f6')
						.attr('fill-opacity', seriesData.metadata?.opacity || 0.3)
						.attr('d', this.area);
				} else {
					// Line chart (default)
					seriesGroup
						.append('path')
						.datum(seriesData.data)
						.attr('class', 'line')
						.attr('fill', 'none')
						.attr('stroke', seriesData.color || '#3b82f6')
						.attr('stroke-width', 2)
						.attr('d', this.line);

					// Add points if configured
					if (this.config.showPoints) {
						seriesGroup
							.selectAll('.point')
							.data(seriesData.data)
							.enter()
							.append('circle')
							.attr('class', 'point')
							.attr('cx', (d) => this.xScale(d.x) as number)
							.attr('cy', (d) => this.yScale(d.y) as number)
							.attr('r', 3)
							.attr('fill', seriesData.color || '#3b82f6')
							.on('click', (event, d) => this.handlePointClick(event, d, seriesData))
							.on('mouseover', (event, d) => this.handlePointHover(event, d, seriesData))
							.on('mouseout', () => this.hideTooltip());
					}
				}
			});

			// Add legend
			this.renderLegend(series.filter((s) => s.visible));
		}

		private renderLegend(series: PlotDataSeries[]) {
			const legendGroup = this.g.selectAll('.legend').data([null]);
			const legendEnter = legendGroup.enter().append('g').attr('class', 'legend');
			const legend = legendEnter.merge(legendGroup as any);

			legend.attr('transform', `translate(${this.width - 100}, 0)`);

			const items = legend.selectAll('.legend-item').data(series, (d: any) => d.id);

			items.exit().remove();

			const itemEnter = items.enter().append('g').attr('class', 'legend-item');

			itemEnter.append('rect').attr('width', 10).attr('height', 10);

			itemEnter.append('text').attr('x', 15).attr('y', 9).style('font-size', '12px');

			const itemMerge = itemEnter.merge(items as any);

			itemMerge.attr('transform', (d, i) => `translate(0, ${i * 20})`);

			itemMerge.select('rect').attr('fill', (d) => d.color || '#3b82f6');

			itemMerge.select('text').text((d) => d.name);
		}

		private zoomed(event: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
			const transform = event.transform;

			// Update scales
			const newXScale = transform.rescaleX(this.xScale);
			const newYScale = transform.rescaleY(this.yScale);

			// Update axes
			this.g.select('.x-axis').call(this.xAxis.scale(newXScale) as any);
			this.g.select('.y-axis').call(this.yAxis.scale(newYScale) as any);

			// Update lines and points
			this.line.x((d) => newXScale(d.x) as number).y((d) => newYScale(d.y) as number);
			this.area
				.x((d) => newXScale(d.x) as number)
				.y0((d) => newYScale(d.metadata?.yMin || 0) as number)
				.y1((d) => newYScale(d.metadata?.yMax || d.y) as number);

			this.g.selectAll('.line').attr('d', this.line as any);
			this.g.selectAll('.area').attr('d', this.area as any);
			this.g
				.selectAll('.point')
				.attr('cx', (d: any) => newXScale(d.x))
				.attr('cy', (d: any) => newYScale(d.y));

			// Emit zoom event
			this.onInteraction({
				type: 'zoom',
				range: {
					x: newXScale.domain() as [number, number],
					y: newYScale.domain() as [number, number]
				}
			});
		}

		private handlePointClick(event: MouseEvent, point: PlotDataPoint, series: PlotDataSeries) {
			event.stopPropagation();

			this.onInteraction({
				type: 'click',
				seriesId: series.id,
				dataPoint: point
			});
		}

		private handlePointHover(event: MouseEvent, point: PlotDataPoint, series: PlotDataSeries) {
			// Show tooltip
			this.tooltip
				.style('opacity', 1)
				.html(
					`
          <div><strong>${series.name}</strong></div>
          <div>X: ${point.x}</div>
          <div>Y: ${point.y.toFixed(3)}</div>
        `
				)
				.style('left', `${event.offsetX + 10}px`)
				.style('top', `${event.offsetY - 10}px`);

			this.onInteraction({
				type: 'hover',
				seriesId: series.id,
				dataPoint: point
			});
		}

		private hideTooltip() {
			this.tooltip.style('opacity', 0);
		}

		appendData(seriesId: string, data: PlotDataPoint | PlotDataPoint[]) {
			// Implementation for appending data
			// This would update the series and re-render
		}

		replaceData(seriesId: string, data: PlotDataPoint | PlotDataPoint[]) {
			// Implementation for replacing data
		}

		updateRange(
			seriesId: string,
			data: PlotDataPoint | PlotDataPoint[],
			range: { start: number; end: number }
		) {
			// Implementation for updating a range of data
		}

		updateConfig(config: TimeSeriesConfig) {
			this.config = { ...this.config, ...config };
			// Re-render with new config
		}

		async exportImage(format: 'png' | 'svg'): Promise<Blob> {
			// Implementation for exporting chart as image
			if (format === 'svg') {
				const svgString = new XMLSerializer().serializeToString(this.svg.node()!);
				return new Blob([svgString], { type: 'image/svg+xml' });
			}

			// For PNG, would need to convert SVG to canvas
			throw new Error('PNG export not implemented');
		}

		destroy() {
			// Clean up
			this.svg.remove();
			this.tooltip.remove();
		}

		private addStyles() {
			const style = document.createElement('style');
			style.textContent = `
        .plot-tooltip {
          transition: opacity 0.2s;
        }
        
        .grid line {
          stroke: #e5e7eb;
          stroke-opacity: 0.7;
        }
        
        .grid path {
          stroke-width: 0;
        }
        
        .point {
          cursor: pointer;
          transition: r 0.2s;
        }
        
        .point:hover {
          r: 5;
        }
        
        .legend-item {
          cursor: pointer;
        }
        
        .legend-item:hover text {
          font-weight: bold;
        }
      `;
			this.container.appendChild(style);
		}
	}
</script>

<div bind:this={container} class="time-series-plot h-full w-full" />

<style>
	.time-series-plot {
		@apply relative overflow-hidden;
	}

	:global(.time-series-plot svg) {
		@apply h-full w-full;
	}
</style>
