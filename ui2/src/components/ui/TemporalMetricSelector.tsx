/**
 * TemporalMetricSelector
 *
 * Dropdown shown only when a 4D volume is active. Lets the user pick
 * a temporal metric (None / Variance / Mean) to overlay on the slice view.
 */

import React from 'react';
import type { TemporalMetric } from '@/services/TemporalHeatmapService';

export type TemporalMetricOption = 'none' | TemporalMetric;

interface TemporalMetricSelectorProps {
  value: TemporalMetricOption;
  onChange: (metric: TemporalMetricOption) => void;
  disabled?: boolean;
  className?: string;
}

const OPTIONS: { value: TemporalMetricOption; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'variance', label: 'Variance' },
  { value: 'mean', label: 'Mean' },
];

export function TemporalMetricSelector({
  value,
  onChange,
  disabled = false,
  className = '',
}: TemporalMetricSelectorProps) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <span className="text-bf-xs text-bf-text-secondary whitespace-nowrap">Temporal:</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as TemporalMetricOption)}
        className="bg-bf-bg-input text-foreground text-bf-xs border border-border rounded-sm px-1 py-0.5 focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
