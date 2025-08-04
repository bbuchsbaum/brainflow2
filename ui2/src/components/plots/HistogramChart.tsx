/**
 * HistogramChart Component
 * Beautiful histogram visualization using Visx
 */

import React, { useMemo, useId, useRef, useEffect } from 'react';
import { scaleLinear, scaleLog } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { BarRounded } from '@visx/shape';
import { Group } from '@visx/group';
import { LinearGradient } from '@visx/gradient';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import type { HistogramChartProps, HistogramBin } from '@/types/histogram';
import { colormaps } from '@/components/ui/ColormapSelector';

// Margin for axes - increased to provide better spacing and ensure chart fits
const margin = { top: 15, right: 15, bottom: 35, left: 15 };

// Tooltip styles
const tooltipStyles = {
  ...defaultStyles,
  backgroundColor: 'rgba(0, 0, 0, 0.9)',
  color: 'white',
  padding: '8px',
  borderRadius: '4px',
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
  const innerWidth = Math.max(width - margin.left - margin.right, 100);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 80);
  
  // Log dimension calculation for debugging
  console.log('[HistogramChart] Dimension calculation:', {
    providedDimensions: { width, height },
    margins: margin,
    innerDimensions: { innerWidth, innerHeight },
    isTooSmall: width < 200 || height < 150
  });

  // Get colormap gradient
  const colormapData = useMemo(() => {
    const cm = colormaps.find(c => c.name === colormap) || colormaps[0];
    // Extract colors from the gradient string
    const gradientMatch = cm.gradient.match(/linear-gradient\(to right,\s*(.+)\)/);
    if (gradientMatch) {
      const colors = gradientMatch[1].split(',').map(c => c.trim());
      return colors;
    }
    return ['#000000', '#ffffff']; // Fallback to grayscale
  }, [colormap]);

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
  if (width < 150 || height < 100) {
    return (
      <div 
        className="flex items-center justify-center text-xs" 
        style={{ width, height }}
      >
        <div className="text-gray-400 text-center">
          Panel too small<br/>for histogram
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
        <div className="text-gray-400">Loading histogram...</div>
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
        <div className="text-red-400 text-sm">Error: {error.message}</div>
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
          <div className="text-gray-400">No histogram data</div>
          <div className="text-xs text-gray-500 mt-1">
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
        {/* Gradient definition for colormap - horizontal to match intensity axis */}
        <defs key={`defs-${colormap}-${Date.now()}`}>
          <LinearGradient 
            id={gradientId}
            key={`gradient-${colormap}-${Date.now()}`}
            from="#000000" 
            to="#ffffff"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            {colormapData.map((color, i) => (
              <stop
                key={i}
                offset={`${(i / (colormapData.length - 1)) * 100}%`}
                stopColor={color}
              />
            ))}
          </LinearGradient>
          
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
            fill="#1a1a1a"
            stroke="#333"
            strokeWidth={1}
          />

          {/* Intensity window overlay */}
          {intensityWindow && (
            <rect
              x={xScale(intensityWindow[0])}
              y={0}
              width={xScale(intensityWindow[1]) - xScale(intensityWindow[0])}
              height={innerHeight}
              fill="rgba(255, 255, 255, 0.05)"
              stroke="rgba(255, 255, 255, 0.2)"
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
                stroke="rgba(255,107,107,0.4)"
                strokeWidth={1}
                strokeDasharray="2,2"
              />
              <line
                x1={xScale(threshold[1])}
                y1={0}
                x2={xScale(threshold[1])}
                y2={innerHeight}
                stroke="rgba(255,107,107,0.4)"
                strokeWidth={1}
                strokeDasharray="2,2"
              />
            </>
          )}

          {/* Single rectangle with gradient, clipped to bar shapes */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill={`url(#${gradientId})`}
            clipPath={`url(#${clipId})`}
            fillOpacity={0.9}
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
              tickFormat={(value) => value.toFixed(0)}
              stroke="#666"
              tickStroke="#666"
              tickLabelProps={() => ({
                fill: '#999',
                fontSize: 10,
                textAnchor: 'middle',
              })}
            />
          )}

          {/* Statistics text */}
          <text
            x={innerWidth - 10}
            y={20}
            fill="#999"
            fontSize={12}
            textAnchor="end"
          >
            μ={data.mean.toFixed(1)}, σ={data.std.toFixed(1)}
          </text>
          
          {/* Log scale toggle button */}
          <g
            transform={`translate(10, 10)`}
            onClick={() => onLogScaleChange?.(!useLogScale)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={0}
              y={0}
              width={55}
              height={20}
              rx={3}
              fill={useLogScale ? '#4a5568' : '#2d3748'}
              stroke={useLogScale ? '#718096' : '#4a5568'}
              strokeWidth={1}
            />
            <text
              x={27.5}
              y={14}
              fill="#e2e8f0"
              fontSize={11}
              textAnchor="middle"
              style={{ userSelect: 'none' }}
            >
              {useLogScale ? 'Log Y' : 'Linear Y'}
            </text>
          </g>
        </Group>
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