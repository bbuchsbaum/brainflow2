import { describe, expect, it } from 'vitest';
import { formatReadoutValue } from '../valueFormat';

describe('formatReadoutValue (QA 2026-10-31: the status bar showed "9.2e-3")', () => {
  it('never uses an exponent', () => {
    for (const v of [9.2e-3, -4.5e-4, 1.234e-5, 1.5e-6, 3e-9, 2.5e6, 123456789]) {
      expect(formatReadoutValue(v)).not.toMatch(/e/i);
    }
  });
  it('keeps three significant digits below 1, including 0.01–1 (review L3)', () => {
    expect(formatReadoutValue(0.0123)).toBe('0.0123');
    expect(formatReadoutValue(0.456)).toBe('0.456');
    expect(formatReadoutValue(0.12345)).toBe('0.123');
    expect(formatReadoutValue(0.5)).toBe('0.5');
    expect(formatReadoutValue(0.0092)).toBe('0.0092');
    expect(formatReadoutValue(0.000123456)).toBe('0.000123');
    expect(formatReadoutValue(-0.00456)).toBe('−0.00456');
    expect(formatReadoutValue(0.0000012)).toBe('0.0000012');
  });

  it('a tiny non-zero value is not shown as zero', () => {
    expect(formatReadoutValue(3e-9)).toBe('<0.000001');
    expect(formatReadoutValue(-3e-9)).toBe('>−0.000001');
  });
  it('matches the layer formatter elsewhere', () => {
    expect(formatReadoutValue(0)).toBe('0');
    expect(formatReadoutValue(3.125)).toBe('3.13');
    expect(formatReadoutValue(-2.3)).toBe('−2.3');
    expect(formatReadoutValue(59000)).toBe('59,000');
    expect(formatReadoutValue(2500000)).toBe('2,500,000');
  });
});
