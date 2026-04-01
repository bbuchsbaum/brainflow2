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
      <span className="text-xs text-gray-400 whitespace-nowrap">Temporal:</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as TemporalMetricOption)}
        className="bg-gray-800 text-gray-200 text-xs border border-gray-600 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
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
