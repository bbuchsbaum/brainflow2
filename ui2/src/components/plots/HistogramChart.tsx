/**
 * HistogramChart Component
 * Beautiful histogram visualization using Visx
 */

import React, { useMemo, useId, useRef, useEffect } from 'react';
import { scaleLinear, scaleLog } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { BarRounded } from '@visx/shape';
import { Group } from '@visx/group';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { histogramAxisTicks, type HistogramChartProps, type HistogramBin } from '@/types/histogram';
import { FilterChip } from '@/components/ui/bf';
import { displayMinus, formatLayerValue, formatRange } from '@/utils/valueFormat';
import { statisticLongName } from '@/utils/statistic';
import { useLayerStore } from '@/stores/layerStore';
import { isThresholdActive } from '@/components/views/viewportFrame/frameFormat';

// The plot well matches the plot body ground (one step below the panel).
const surfaceColor = 'var(--bf-bg-app)';
const borderColor = 'hsl(var(--border))';
const overlayFill = 'hsla(var(--foreground) / 0.05)';
const overlayStroke = 'hsla(var(--foreground) / 0.18)';
// Threshold marks are data annotations: a neutral light dashed line, never the
// chrome accent or the primary (button) colour.
const thresholdColor = 'var(--bf-text-secondary)';
const statsTextColor = 'var(--bf-text-muted)';
const axisStroke = 'hsla(var(--foreground) / 0.35)';
// Tick text: secondary text on the panel (well above 4.5:1), at the 2xs step.
const axisLabelColor = 'var(--bf-text-secondary)';
const axisLabelSize = 'var(--bf-text-2xs)';
// Bars are a neutral light grey, not a hue: next to diverging (red-blue) maps
// any blue reads as "negative". The layer's colours belong to the image.
const barFill = 'var(--bf-text-secondary)';
const barFillOpacity = 0.45;
const tooltipBg = 'hsl(var(--card))';
const tooltipColor = 'hsl(var(--foreground))';
const tooltipBorder = 'hsl(var(--border))';

// The top margin is a header line that holds the scale toggle (left, a 24px
// bf FilterChip over the SVG) and the mean/SD summary (right), so neither
// overprints the bars. The bottom margin fits the x-axis ticks and labels.
const BASE_MARGIN = { top: 28, right: 12, bottom: 22, left: 12 };
const HEADER_BASELINE = 16;
/** Room the Log Y toggle takes at the header's right end. */
const LOG_TOGGLE_WIDTH = 56;
/** Extra bottom margin for the x-axis title (the statistic symbol). */
const AXIS_TITLE_HEIGHT = 12;
/** Below these sizes the chart cannot draw meaningful bars. */
const MIN_CHART_WIDTH = 120;
const MIN_CHART_HEIGHT = 64;

// Tooltip styles
const tooltipStyles = {
  ...defaultStyles,
  backgroundColor: tooltipBg,
  color: tooltipColor,
  padding: '8px',
  borderRadius: '2px',
  border: `1px solid ${tooltipBorder}`,
  fontSize: '12px',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
};

/** Powers of ten from 1 up to `max` (the log y-axis ticks: 1, 10, 100, …). */
export function logDecadeTicks(max: number): number[] {
  const ticks: number[] = [];
  for (let t = 1; t <= max && ticks.length < 12; t *= 10) ticks.push(t);
  return ticks;
}

/** Compact count label: 1, 10, 100, 1k, 10k, 100k, 1M. */
export function formatCountTick(v: number): string {
  if (v >= 1e6) return `${v / 1e6}M`;
  if (v >= 1e3) return `${v / 1e3}k`;
  return String(v);
}

/** Log-scale domain floor: below 1 so a single-count bin has visible height. */
const LOG_DOMAIN_MIN = 0.5;

/**
 * Bar top and height for one bin. Zero-count (or non-finite) bins draw
 * nothing in either scale: through a log scale they would be log(0) = NaN.
 */
function barGeometry(
  count: number,
  yScale: (v: number) => number | undefined,
  innerHeight: number,
): { barY: number; barHeight: number } | null {
  if (!(count > 0) || !Number.isFinite(count)) return null;
  const barY = yScale(count);
  if (barY === undefined || !Number.isFinite(barY)) return null;
  return { barY, barHeight: Math.max(0, innerHeight - barY) };
}

export const HistogramChart: React.FC<HistogramChartProps> = ({
  data,
  width,
  height,
  intensityWindow,
  threshold,
  colormap = 'gray',
  showAxes = true,
  showTooltips = true,
  useLogScale = false,
  onIntensityChange,
  onThresholdChange,
  onLogScaleChange,
  loading = false,
  error = null,
  xTitle = null,
}) => {
  // Label maps are categorical: a mean / SD of label ids means nothing.
  const isLabelMap = useLayerStore((s) => {
    const layer = data?.layerId ? s.layers.find((l) => l.id === data.layerId) : undefined;
    return layer?.type === 'label' || layer?.isLabelMap === true;
  });
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip<HistogramBin>();

  // Generate unique ID for this chart instance to prevent SVG ID collisions
  const uniqueId = useId();
  
  // Track gradient IDs for cleanup
  const gradientIds = useRef<Set<string>>(new Set());
  const clipIds = useRef<Set<string>>(new Set());
  
  // Create dynamic gradient ID that changes with colormap to force browser updates
  const gradientId = useMemo(() => 
    `histogram-gradient-${uniqueId}-${colormap}-${Date.now()}`, 
    [uniqueId, colormap]
  );
  
  // Create dynamic clip path ID that changes with colormap
  const clipId = useMemo(() => 
    `histogram-bars-clip-${uniqueId}-${colormap}-${Date.now()}`, 
    [uniqueId, colormap]
  );
  
  // Track current IDs
  useEffect(() => {
    gradientIds.current.add(gradientId);
    clipIds.current.add(clipId);
  }, [gradientId, clipId]);
  
  // Cleanup old gradient definitions on unmount
  useEffect(() => {
    return () => {
      // Clean up all tracked gradient definitions
      gradientIds.current.forEach(id => {
        const element = document.getElementById(id);
        if (element && element.parentNode) {
          element.parentNode.removeChild(element);
        }
      });
      
      // Clean up all tracked clip path definitions
      clipIds.current.forEach(id => {
        const element = document.getElementById(id);
        if (element && element.parentNode) {
          element.parentNode.removeChild(element);
        }
      });
      
      gradientIds.current.clear();
      clipIds.current.clear();
    };
  }, []);

  // Calculate inner dimensions with minimum size validation
  // Never floor these above the available space: a floor larger than the
  // box makes the SVG overflow and clip the axis.
  // Log Y draws a y axis at powers of ten (1, 10, 100, …): without it a log
  // histogram is easy to misread as linear. The left margin grows to fit the
  // widest tick label; linear keeps its axis-free layout.
  // Count ticks on the y axis in both scales (v3 user critic: a linear
  // histogram without y ticks has no magnitude): decades in log, 3 nice
  // ticks in linear.
  const maxCount = data && data.bins.length > 0 ? Math.max(1, ...data.bins.map((b) => b.count)) : 0;
  const logTicks =
    showAxes && maxCount > 0
      ? useLogScale
        ? logDecadeTicks(maxCount)
        : scaleLinear<number>({ domain: [0, maxCount], nice: false })
            .ticks(3)
            .filter((t) => t > 0 && t <= maxCount)
      : [];
  const baseMargin = xTitle ? { ...BASE_MARGIN, bottom: BASE_MARGIN.bottom + AXIS_TITLE_HEIGHT } : BASE_MARGIN;
  const margin =
    logTicks.length > 0
      ? {
          ...baseMargin,
          left: BASE_MARGIN.left + 6 + Math.max(...logTicks.map((t) => formatCountTick(t).length)) * 6,
        }
      : baseMargin;
  const innerWidth = Math.max(width - margin.left - margin.right, 1);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 1);
  
  // Log dimension calculation for debugging
  console.log('[HistogramChart] Dimension calculation:', {
    providedDimensions: { width, height },
    margins: margin,
    innerDimensions: { innerWidth, innerHeight },
    isTooSmall: width < MIN_CHART_WIDTH || height < MIN_CHART_HEIGHT
  });

  // Create scales
  // Label maps: integer, non-repeating ticks.
  const integerData = !!data?.integerValued;
  const xScale = useMemo(() => {
    if (!data || data.bins.length === 0) {
      return scaleLinear<number>({
        domain: [0, 1],
        range: [0, innerWidth],
      });
    }
    return scaleLinear<number>({
      domain: [data.minValue, data.maxValue],
      range: [0, innerWidth],
    });
  }, [data, innerWidth]);
  const xTicks = useMemo(
    () => histogramAxisTicks(xScale.ticks(Math.max(2, Math.floor(innerWidth / 60))), integerData),
    [xScale, innerWidth, integerData],
  );

  const yScale = useMemo(() => {
    if (!data || data.bins.length === 0) {
      return scaleLinear<number>({
        domain: [0, 1],
        range: [innerHeight, 0],
      });
    }
    const maxCount = Math.max(...data.bins.map(b => b.count));
    
    if (useLogScale) {
      // log(0) is undefined: zero-count bins are not drawn at all (see
      // barGeometry), and the domain floor sits at 0.5 so a single-count bin
      // still has visible height.
      return scaleLog<number>({
        domain: [LOG_DOMAIN_MIN, Math.max(maxCount, 1)],
        range: [innerHeight, 0],
        base: 10,
      });
    } else {
      return scaleLinear<number>({
        domain: [0, maxCount],
        range: [innerHeight, 0],
      });
    }
  }, [data, innerHeight, useLogScale]);

  // Handle chart too small
  if (width < MIN_CHART_WIDTH || height < MIN_CHART_HEIGHT) {
    return (
      <div 
        className="flex items-center justify-center text-xs" 
        style={{ width, height }}
      >
        <div className="text-muted-foreground text-center">
          Enlarge the panel to see the histogram
        </div>
      </div>
    );
  }

  // Handle loading state
  if (loading) {
    return (
      <div 
        className="flex items-center justify-center" 
        style={{ width, height }}
      >
        <div className="text-muted-foreground">Loading histogram...</div>
      </div>
    );
  }

  // Handle error state
  if (error) {
    return (
      <div 
        className="flex items-center justify-center" 
        style={{ width, height }}
      >
        <div className="text-bf-danger text-bf-sm">Error: {error.message}</div>
      </div>
    );
  }

  // Handle no data with more informative message
  if (!data || data.bins.length === 0) {
    return (
      <div 
        className="flex items-center justify-center" 
        style={{ width, height }}
      >
        <div className="text-center">
          <div className="text-muted-foreground">No histogram data</div>
          <div className="text-xs text-muted-foreground mt-1 opacity-80">
            {!data ? 'Waiting for data...' : 'Empty histogram (0 bins)'}
          </div>
        </div>
      </div>
    );
  }

  const calculatedBarWidth = innerWidth / data.bins.length;
  // Use actual bar width to prevent overflow, but ensure at least 1px for visibility
  // When there are many bins, we need to use the actual calculated width to prevent
  // the total width of all bars from exceeding the chart width
  const barWidth = Math.max(1, Math.min(calculatedBarWidth, 3));
  
  // If bars would be too thin, reduce bin count recommendation
  const recommendedBinCount = calculatedBarWidth < 3 ? Math.floor(innerWidth / 3) : data.bins.length;

  // Debug logging
  console.log('[HistogramChart] Rendering histogram:', {
    dataRange: [data.minValue, data.maxValue],
    mean: data.mean,
    std: data.std,
    totalCount: data.totalCount,
    binCount: data.bins.length,
    calculatedBarWidth,
    actualBarWidth: barWidth,
    recommendedBinCount,
    innerDimensions: [innerWidth, innerHeight],
    nonZeroBins: data.bins.filter(b => b.count > 0).length,
    maxBinCount: Math.max(...data.bins.map(b => b.count)),
    firstFewBins: data.bins.slice(0, 5).map(b => ({
      range: [b.x0, b.x1],
      count: b.count
    }))
  });

  return (
    <div className="relative">
      <svg width={width} height={height}>
        <defs key={`defs-${colormap}-${Date.now()}`}>
          {/* Create a single clipping mask for all bars */}
          <clipPath 
            id={clipId}
            key={`clip-${colormap}-${Date.now()}`}
          >
            {data.bins.map((bin, i) => {
              const geom = barGeometry(bin.count, yScale, innerHeight);
              if (!geom) return null;
              const { barY, barHeight } = geom;
              // Don't add margins here - the clip path is applied to elements already inside the translated group
              const barX = xScale(bin.x0);

              // Only apply corner radius for wider bars to prevent rendering issues
              const cornerRadius = barWidth >= 5 ? 2 : 0;
              
              return (
                <rect
                  key={`clip-${i}`}
                  x={barX}
                  y={barY}
                  width={Math.max(1, barWidth - 1)}
                  height={Math.max(0, barHeight)}
                  rx={cornerRadius}
                  ry={cornerRadius}
                />
              );
            })}
          </clipPath>
        </defs>

        <Group left={margin.left} top={margin.top}>
          {/* Background */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill={surfaceColor}
            stroke={borderColor}
            strokeWidth={1}
          />

          {/* Intensity window overlay */}
          {intensityWindow && (
            // Edges on the pixel grid (+0.5 for the 1px stroke): crisp, and
            // the same pixels whatever sub-pixel width the chart measured.
            <rect
              x={Math.round(xScale(intensityWindow[0]) as number) + 0.5}
              y={0.5}
              width={Math.max(
                0,
                Math.round(xScale(intensityWindow[1]) as number) -
                  Math.round(xScale(intensityWindow[0]) as number),
              )}
              height={innerHeight}
              fill={overlayFill}
              stroke={overlayStroke}
              strokeWidth={1}
              strokeDasharray="4,2"
            />
          )}

          {/* Threshold lines: solid 1px with their value in mono at the
              top (the colorbar's grammar), not dashed. */}
          {threshold &&
            isThresholdActive(threshold) &&
            [threshold[0], threshold[1]].map((t, k) => {
              const tx = Math.round(xScale(t) as number) + 0.5;
              if (!(tx >= 0 && tx <= innerWidth)) return null;
              return (
                <g key={k} data-testid="histogram-threshold">
                  <line x1={tx} y1={0} x2={tx} y2={innerHeight} stroke={thresholdColor} strokeWidth={1} />
                  <text
                    // Inside the plot's top, beside its line (clear of the
                    // header caption and summary).
                    x={k === 0 ? tx - 3 : tx + 3}
                    y={10}
                    fill={axisLabelColor}
                    fontSize={10}
                    textAnchor={k === 0 ? 'end' : 'start'}
                    style={{ fontFamily: 'var(--bf-font-mono)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatLayerValue(t)}
                  </text>
                </g>
              );
            })}

          {/* Single rectangle clipped to the bar shapes. Bars are neutral
              light grey (as in the Inspector mini histogram) at a moderate
              opacity so the dock is not a bright mass; the window band and
              threshold marks are neutral too. */}
          <rect
            data-testid="histogram-bars"
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill={barFill}
            clipPath={`url(#${clipId})`}
            fillOpacity={barFillOpacity}
          />

          {/* Invisible bars for hover interaction */}
          {data.bins.map((bin, i) => {
            // Same geometry as the clip path.
            const geom = barGeometry(bin.count, yScale, innerHeight);
            if (!geom) return null;
            const { barY, barHeight } = geom;
            const barX = xScale(bin.x0);

            return (
              <rect
                key={`hover-${i}`}
                x={barX}
                y={barY}
                width={Math.max(1, barWidth - 1)}
                height={Math.max(0, barHeight)}
                fill="transparent"
                onMouseEnter={() => {
                  if (showTooltips) {
                    showTooltip({
                      tooltipData: bin,
                      tooltipLeft: barX + barWidth / 2,
                      tooltipTop: barY,
                    });
                  }
                }}
                onMouseLeave={() => {
                  hideTooltip();
                }}
                style={{ cursor: 'pointer' }}
              />
            );
          })}

          {logTicks.length > 0 && (
            <AxisLeft
              scale={yScale}
              tickValues={logTicks}
              tickLength={3}
              tickFormat={(value) => formatCountTick(Number(value))}
              stroke={axisStroke}
              tickStroke={axisStroke}
              tickLabelProps={() => ({
                fill: axisLabelColor,
                fontSize: 10,
                style: { fontSize: axisLabelSize, fontVariantNumeric: 'tabular-nums' },
                textAnchor: 'end',
                dx: -2,
                dy: '0.33em',
              })}
            />
          )}

          {/* X-axis; a y axis only in log mode (above). */}
          {showAxes && (
            <AxisBottom
              top={innerHeight}
              scale={xScale}
              tickLength={4}
              tickValues={xTicks.values}
              tickFormat={(value) => xTicks.format(Number(value))}
              stroke={axisStroke}
              tickStroke={axisStroke}
              tickLabelProps={() => ({
                fill: axisLabelColor,
                fontSize: 10,
                style: { fontSize: axisLabelSize },
                textAnchor: 'middle',
              })}
            />
          )}

          {/* Axis title: the statistic's variable, italic (P3.12). */}
          {showAxes && xTitle ? (
            <text
              data-testid="histogram-x-title"
              x={innerWidth / 2}
              y={innerHeight + 22 + AXIS_TITLE_HEIGHT - 2}
              fill={axisLabelColor}
              fontSize={10}
              textAnchor="middle"
              style={{ fontStyle: 'italic' }}
              // Spoken as the long name ("z score, inferred from file
              // name"), never "z star".
              role="img"
              aria-label={statisticLongName(xTitle)}
            >
              {xTitle}
            </text>
          ) : null}

        </Group>

        {/* Header line (inside the top margin, outside the plot area). The
            summary is dropped when it would collide with the toggle. */}
        {width >= 180 && (
        <text
          data-testid="histogram-stats"
          x={width - margin.right - LOG_TOGGLE_WIDTH}
          y={HEADER_BASELINE}
          fill={statsTextColor}
          fontSize={10}
          textAnchor="end"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {isLabelMap ? (
            data.zerosExcluded ? 'background (0) excluded' : null
          ) : (
            <>
              μ={formatLayerValue(data.mean)}  σ={formatLayerValue(data.std)}
              {data.zerosExcluded ? ' · zeros excluded' : ''}
            </>
          )}
        </text>
        )}

      </svg>

      {/* Log-scale toggle (HTML, so it is a real keyboard-operable button). */}
      <FilterChip
        pressed={useLogScale}
        onPressedChange={(next) => onLogScaleChange?.(next)}
        className="absolute"
        // Top-right corner, after the summary (the encoding caption takes
        // the top-left).
        style={{ right: margin.right, top: 2 }}
        title={useLogScale ? 'Y axis: log scale' : 'Y axis: linear scale'}
      >
        Log Y
      </FilterChip>

      {/* Tooltip */}
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          key={Math.random()}
          top={tooltipTop! + margin.top}
          left={tooltipLeft! + margin.left}
          style={tooltipStyles}
        >
          <div style={{ fontSize: '12px' }}>
            <div>
              <strong>Intensity:</strong> {formatRange(tooltipData.x0, tooltipData.x1, (v) => displayMinus(v.toFixed(0)))}
            </div>
            <div>
              <strong>Count:</strong> {tooltipData.count.toLocaleString()}
            </div>
            <div>
              <strong>Percent:</strong> {tooltipData.percentage.toFixed(1)}%
            </div>
          </div>
        </TooltipWithBounds>
      )}
    </div>
  );
};
