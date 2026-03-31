/**
 * BidsEventsTimeline — swimlane timeline for fMRI event data
 *
 * One horizontal lane per trial_type. Events rendered as colored rectangles.
 * Color assignment: Okabe-Ito palette via deterministic hash; baseline/fixation
 * variants map to neutral gray. No decorative gridlines — only 0.5px axis rule.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { scaleLinear, scaleBand } from '@visx/scale';
import { AxisBottom } from '@visx/axis';
import { Group } from '@visx/group';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import type { BidsEventRow } from '@/stores/bidsStore';

// ---------------------------------------------------------------------------
// Design constants — 4px grid
// ---------------------------------------------------------------------------

const LANE_HEIGHT = 24;
const LANE_GAP = 4;
const LABEL_WIDTH = 120;
const MARGIN = { top: 8, right: 12, bottom: 32, left: 0 };

const axisStroke = 'hsl(var(--border))';
const axisTickColor = 'hsla(var(--foreground) / 0.4)';
const labelColor = 'hsla(var(--foreground) / 0.75)';

// ---------------------------------------------------------------------------
// Okabe-Ito palette — colorblind-safe deterministic assignment
// ---------------------------------------------------------------------------

const OKABE_ITO = [
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#009E73', // green
  '#F0E442', // yellow
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
];

function colorForTrialType(trialType: string): string {
  if (/baseline|fixation|rest|null/i.test(trialType)) return '#888888';
  let hash = 0;
  for (let i = 0; i < trialType.length; i++) {
    hash = ((hash << 5) - hash + trialType.charCodeAt(i)) | 0;
  }
  return OKABE_ITO[Math.abs(hash) % OKABE_ITO.length];
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface EventTooltipData {
  trialType: string;
  onset: number;
  duration: number;
  additional: Record<string, string>;
}

const tooltipStyles: React.CSSProperties = {
  ...defaultStyles,
  backgroundColor: 'hsl(var(--card))',
  color: 'hsl(var(--foreground))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--app-radius-md)',
  padding: '6px 8px',
  fontSize: 'var(--app-text-xs)',
  fontFamily: 'var(--app-font-mono)',
  boxShadow: 'var(--app-shadow-md)',
  pointerEvents: 'none',
};

// ---------------------------------------------------------------------------
// Legend strip
// ---------------------------------------------------------------------------

function TimelineLegend({ trialTypes }: { trialTypes: string[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 16px',
        padding: '4px 0 8px 0',
        fontFamily: 'var(--app-font-mono)',
        fontSize: 10,
        color: labelColor,
      }}
    >
      {trialTypes.map((t) => (
        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              background: colorForTrialType(t),
              borderRadius: 1,
              flexShrink: 0,
            }}
          />
          {t}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface BidsEventsTimelineProps {
  events: BidsEventRow[];
}

export function BidsEventsTimeline({ events }: BidsEventsTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Observe container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } =
    useTooltip<EventTooltipData>();

  // Derived dimensions
  const trialTypes = useMemo(
    () => Array.from(new Set(events.map((e) => e.trial_type))).sort(),
    [events],
  );

  const maxTime = useMemo(() => {
    if (events.length === 0) return 1;
    return Math.max(...events.map((e) => e.onset + e.duration), 1);
  }, [events]);

  // Chart geometry
  const chartWidth = Math.max(containerWidth - LABEL_WIDTH - MARGIN.left - MARGIN.right, 0);
  const laneCount = trialTypes.length;
  const chartHeight = laneCount * (LANE_HEIGHT + LANE_GAP);
  const svgHeight = chartHeight + MARGIN.top + MARGIN.bottom;

  // Scales
  const xScale = useMemo(
    () => scaleLinear({ domain: [0, maxTime], range: [0, chartWidth] }),
    [maxTime, chartWidth],
  );

  const yScale = useMemo(
    () =>
      scaleBand({
        domain: trialTypes,
        range: [0, chartHeight],
        padding: LANE_GAP / (LANE_HEIGHT + LANE_GAP),
      }),
    [trialTypes, chartHeight],
  );

  if (events.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 120,
          fontFamily: 'var(--app-font-mono)',
          fontSize: 11,
          color: 'hsla(var(--foreground) / 0.4)',
          letterSpacing: '0.08em',
        }}
      >
        NO EVENTS
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
      <TimelineLegend trialTypes={trialTypes} />

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* Lane labels — fixed width, vertically aligned to each lane */}
        <div
          style={{
            width: LABEL_WIDTH,
            flexShrink: 0,
            paddingTop: MARGIN.top,
          }}
        >
          {trialTypes.map((tt) => {
            const y = yScale(tt) ?? 0;
            return (
              <div
                key={tt}
                title={tt}
                style={{
                  position: 'absolute',
                  top: MARGIN.top + y + (LANE_HEIGHT - 11) / 2,
                  left: 0,
                  width: LABEL_WIDTH - 8,
                  fontFamily: 'var(--app-font-mono)',
                  fontSize: 10,
                  color: labelColor,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  paddingRight: 4,
                  textAlign: 'right',
                  lineHeight: `${LANE_HEIGHT}px`,
                }}
              >
                {tt}
              </div>
            );
          })}
        </div>

        {/* SVG chart area */}
        {containerWidth > 0 && (
          <svg
            width={chartWidth + MARGIN.left + MARGIN.right}
            height={svgHeight}
            style={{ overflow: 'visible', display: 'block' }}
          >
            <Group left={MARGIN.left} top={MARGIN.top}>
              {/* Lane background tracks — subtle alternation */}
              {trialTypes.map((tt, i) => {
                const y = yScale(tt) ?? 0;
                return (
                  <rect
                    key={`track-${tt}`}
                    x={0}
                    y={y}
                    width={chartWidth}
                    height={LANE_HEIGHT}
                    fill={
                      i % 2 === 0
                        ? 'hsla(var(--foreground) / 0.025)'
                        : 'transparent'
                    }
                  />
                );
              })}

              {/* Events */}
              {events.map((event, idx) => {
                const x = xScale(event.onset);
                const rawW = xScale(event.duration) - xScale(0);
                const w = Math.max(2, rawW);
                const y = yScale(event.trial_type) ?? 0;
                const color = colorForTrialType(event.trial_type);
                const isZeroDuration = event.duration === 0 || rawW < 2;

                return (
                  <rect
                    key={idx}
                    x={x}
                    y={y}
                    width={w}
                    height={LANE_HEIGHT}
                    fill={isZeroDuration ? color : color}
                    opacity={isZeroDuration ? 0.9 : 0.8}
                    style={{ cursor: 'crosshair' }}
                    onMouseEnter={(e) => {
                      const svgRect = (e.currentTarget.ownerSVGElement as SVGSVGElement)
                        .getBoundingClientRect();
                      showTooltip({
                        tooltipData: {
                          trialType: event.trial_type,
                          onset: event.onset,
                          duration: event.duration,
                          additional: event.additional,
                        },
                        tooltipLeft: e.clientX - svgRect.left + MARGIN.left + LABEL_WIDTH,
                        tooltipTop: e.clientY - svgRect.top,
                      });
                    }}
                    onMouseLeave={hideTooltip}
                  />
                );
              })}

              {/* X axis — 0.5px rule only */}
              <AxisBottom
                top={chartHeight}
                scale={xScale}
                stroke={axisStroke}
                strokeWidth={0.5}
                tickStroke={axisStroke}
                tickLength={4}
                tickLabelProps={() => ({
                  fill: axisTickColor,
                  fontSize: 10,
                  fontFamily: 'var(--app-font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  textAnchor: 'middle',
                })}
                tickFormat={(v) => `${Number(v).toFixed(0)}s`}
              />
            </Group>
          </svg>
        )}
      </div>

      {/* Tooltip */}
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          top={tooltipTop}
          left={tooltipLeft}
          style={tooltipStyles}
          offsetLeft={8}
          offsetTop={-8}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                marginBottom: 4,
                fontWeight: 600,
                fontSize: 11,
                color: colorForTrialType(tooltipData.trialType),
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  background: colorForTrialType(tooltipData.trialType),
                  borderRadius: 1,
                }}
              />
              {tooltipData.trialType}
            </div>
            <div style={{ color: 'hsla(var(--foreground) / 0.8)', lineHeight: 1.6 }}>
              <span style={{ color: axisTickColor }}>onset</span>{' '}
              {tooltipData.onset.toFixed(3)}s
              <br />
              <span style={{ color: axisTickColor }}>duration</span>{' '}
              {tooltipData.duration.toFixed(3)}s
              {tooltipData.additional.response_time && (
                <>
                  <br />
                  <span style={{ color: axisTickColor }}>rt</span>{' '}
                  {tooltipData.additional.response_time}s
                </>
              )}
            </div>
          </div>
        </TooltipWithBounds>
      )}
    </div>
  );
}
