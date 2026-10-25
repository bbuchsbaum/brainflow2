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
import type { HistogramChartProps, HistogramBin } from '@/types/histogram';

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
const toggleActiveFill = 'hsl(var(--primary))';
const toggleInactiveFill = 'hsl(var(--muted))';
const toggleStroke = 'hsl(var(--border))';
const toggleTextColor = 'hsl(var(--foreground))';
const toggleActiveTextColor = 'hsl(var(--primary-foreground))';
const tooltipBg = 'hsl(var(--card))';
const tooltipColor = 'hsl(var(--foreground))';
const tooltipBorder = 'hsl(var(--border))';

// The top margin is a header line that holds the scale toggle (left) and the
// mean/SD summary (right), so neither overprints the bars. The bottom margin
// fits the x-axis ticks and labels.
const margin = { top: 20, right: 12, bottom: 22, left: 12 };
const HEADER_BASELINE = 13;
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
}) => {
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

  const yScale = useMemo(() => {
    if (!data || data.bins.length === 0) {
      return scaleLinear<number>({
        domain: [0, 1],
        range: [innerHeight, 0],
      });
    }
    const maxCount = Math.max(...data.bins.map(b => b.count));
    
    if (useLogScale) {
      // For log scale, we need to handle zero counts
      // Use 1 as the minimum to avoid log(0)
      const minCount = 1;
      return scaleLog<number>({
        domain: [minCount, Math.max(maxCount, minCount + 1)],
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
              // For log scale, we need to handle zero counts specially
              const effectiveCount = useLogScale && bin.count === 0 ? 0 : bin.count;
              const barY = useLogScale && bin.count > 0 ? yScale(Math.max(1, bin.count)) : yScale(bin.count);
              const barHeight = useLogScale && bin.count > 0 
                ? innerHeight - barY
                : (bin.count === 0 ? 0 : innerHeight - barY);
              
              // Don't add margins here - the clip path is applied to elements already inside the translated group
              const barX = xScale(bin.x0);
              
              if (bin.count === 0 && !useLogScale) return null;
              
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
            <rect
              x={xScale(intensityWindow[0])}
              y={0}
              width={xScale(intensityWindow[1]) - xScale(intensityWindow[0])}
              height={innerHeight}
              fill={overlayFill}
              stroke={overlayStroke}
              strokeWidth={1}
              strokeDasharray="4,2"
            />
          )}

          {/* Threshold lines */}
          {threshold && (
            <>
              <line
              x1={xScale(threshold[0])}
              y1={0}
              x2={xScale(threshold[0])}
              y2={innerHeight}
              stroke={thresholdColor}
              strokeWidth={1}
              strokeDasharray="2,2"
            />
            <line
              x1={xScale(threshold[1])}
              y1={0}
              x2={xScale(threshold[1])}
              y2={innerHeight}
              stroke={thresholdColor}
              strokeWidth={1}
              strokeDasharray="2,2"
            />
          </>
          )}

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
            // Use same calculation as clip path for consistency
            const barY = useLogScale && bin.count > 0 ? yScale(Math.max(1, bin.count)) : yScale(bin.count);
            const barHeight = useLogScale && bin.count > 0 
              ? innerHeight - barY
              : (bin.count === 0 ? 0 : innerHeight - barY);
            const barX = xScale(bin.x0);

            if (bin.count === 0 && !useLogScale) return null;
            
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

          {/* X-axis only - Y-axis removed to save space */}
          {showAxes && (
            <AxisBottom
              top={innerHeight}
              scale={xScale}
              tickLength={4}
              numTicks={Math.max(2, Math.floor(innerWidth / 60))}
              tickFormat={(value) => Number(value).toFixed(0)}
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

        </Group>

        {/* Header line (inside the top margin, outside the plot area). The
            summary is dropped when it would collide with the toggle. */}
        {width >= 180 && (
        <text
          data-testid="histogram-stats"
          x={width - margin.right}
          y={HEADER_BASELINE}
          fill={statsTextColor}
          fontSize={10}
          textAnchor="end"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          μ={data.mean.toFixed(1)}  σ={data.std.toFixed(1)}
        </text>
        )}

        {/* Log scale toggle button */}
        <g
          transform={`translate(${margin.left}, 2)`}
          onClick={() => onLogScaleChange?.(!useLogScale)}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={0}
            y={0}
            width={48}
            height={15}
            rx={2}
            fill={useLogScale ? toggleActiveFill : toggleInactiveFill}
            stroke={toggleStroke}
            strokeWidth={1}
          />
          <text
            x={24}
            y={11}
            fill={useLogScale ? toggleActiveTextColor : toggleTextColor}
            fontSize={10}
            textAnchor="middle"
            style={{ userSelect: 'none' }}
          >
            {useLogScale ? 'Log Y' : 'Linear Y'}
          </text>
        </g>
      </svg>

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
              <strong>Intensity:</strong> {tooltipData.x0.toFixed(0)} - {tooltipData.x1.toFixed(0)}
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
