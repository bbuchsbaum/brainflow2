import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HistogramChart } from '../HistogramChart';
import type { HistogramData } from '@/types/histogram';

// Zero-count bins between populated ones (the case that produced
// "Received NaN for the `y` attribute" under Log Y).
const counts = [0, 5, 0, 0, 1, 120, 0, 3000, 0, 0];
const data: HistogramData = {
  bins: counts.map((count, i) => ({
    x0: i * 25,
    x1: (i + 1) * 25,
    count,
    normalizedCount: count / 3000,
    percentage: (count / 3126) * 100,
  })),
  totalCount: 3126,
  minValue: 0,
  maxValue: 250,
  mean: 150,
  std: 30,
  binCount: counts.length,
  layerId: 'l1',
};

function Host() {
  const [log, setLog] = useState(false);
  return (
    <HistogramChart
      data={data}
      width={400}
      height={200}
      useLogScale={log}
      onLogScaleChange={setLog}
      showTooltips={false}
    />
  );
}

function nanAttributes(root: Element): string[] {
  const bad: string[] = [];
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/NaN|Infinity/.test(attr.value)) bad.push(`<${el.tagName} ${attr.name}="${attr.value}">`);
    }
  });
  return bad;
}

describe('HistogramChart: Log Y with zero-count bins', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('toggling Log Y renders no NaN attributes and logs no errors', () => {
    const { container } = render(<Host />);
    const toggle = screen.getByRole('button', { name: /Log Y/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(nanAttributes(container)).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();

    // Populated bins only; a single-count bin still has height above 0.
    const clipRects = container.querySelectorAll('clipPath rect');
    expect(clipRects).toHaveLength(counts.filter((c) => c > 0).length);
    const heights = Array.from(clipRects).map((r) => Number(r.getAttribute('height')));
    expect(heights.every((h) => Number.isFinite(h) && h > 0)).toBe(true);

    fireEvent.click(toggle);
    expect(nanAttributes(container)).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('HistogramChart: Log Y axis ticks', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws y ticks at 1, 10, 100, 1k under Log Y and three count ticks in linear mode', () => {
    const { container } = render(<Host />);
    const yLabels = () =>
      Array.from(container.querySelectorAll('.visx-axis-left .visx-axis-tick text')).map((t) => t.textContent);
    // Linear: a magnitude on the y axis too (v3 user critic). Max count 3000.
    expect(yLabels()).toEqual(['1k', '2k', '3k']);
    fireEvent.click(screen.getByRole('button', { name: 'Log Y' }));
    // Max bin count is 3000: decades 1 … 1000.
    expect(yLabels()).toEqual(['1', '10', '100', '1k']);
    expect(nanAttributes(container)).toEqual([]);
  });

  it('logDecadeTicks / formatCountTick', async () => {
    const { logDecadeTicks, formatCountTick } = await import('../HistogramChart');
    expect(logDecadeTicks(1)).toEqual([1]);
    expect(logDecadeTicks(999)).toEqual([1, 10, 100]);
    expect(logDecadeTicks(25000)).toEqual([1, 10, 100, 1000, 10000]);
    expect([1, 100, 1000, 10000, 1e6].map(formatCountTick)).toEqual(['1', '100', '1k', '10k', '1M']);
  });
});
