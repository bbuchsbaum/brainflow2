import { describe, expect, it } from 'vitest';
import { formatReadoutValue } from '../valueFormat';

describe('formatReadoutValue (QA 2026-10-31: the status bar showed "9.2e-3")', () => {
  it('never uses an exponent', () => {
    for (const v of [9.2e-3, -4.5e-4, 1.234e-5, 1.5e-6, 3e-9, 2.5e6, 123456789]) {
      expect(formatReadoutValue(v)).not.toMatch(/e/i);
    }
  });
  it('keeps four significant digits below 1 (one pointer precision everywhere), including 0.01–1', () => {
    expect(formatReadoutValue(0.0123)).toBe('0.0123');
    expect(formatReadoutValue(0.456)).toBe('0.456');
    expect(formatReadoutValue(0.12345)).toBe('0.1235');
    expect(formatReadoutValue(-0.017183)).toBe('−0.01718');
    expect(formatReadoutValue(0.5)).toBe('0.5');
    expect(formatReadoutValue(0.0092)).toBe('0.0092');
    expect(formatReadoutValue(0.000123456)).toBe('0.0001235');
    expect(formatReadoutValue(-0.00456)).toBe('−0.00456');
    expect(formatReadoutValue(0.0000012)).toBe('0.0000012');
  });
  it('takes another precision when asked (scale ends keep three)', () => {
    expect(formatReadoutValue(0.12345, 3)).toBe('0.123');
    expect(formatReadoutValue(-0.017183, 3)).toBe('−0.0172');
  });

  it('a tiny non-zero value is not shown as zero', () => {
    expect(formatReadoutValue(3e-9)).toBe('<0.000001');
    expect(formatReadoutValue(-3e-9)).toBe('>−0.000001');
  });
  it('keeps the same precision on both sides of 1 below 1000 (review 2026-11-12)', () => {
    expect(formatReadoutValue(0.9876)).toBe('0.9876');
    expect(formatReadoutValue(1.23456)).toBe('1.235');
    expect(formatReadoutValue(12.3456)).toBe('12.35');
    expect(formatReadoutValue(123.456)).toBe('123.5');
    expect(formatReadoutValue(-12.3456)).toBe('−12.35');
    expect(formatReadoutValue(3.125)).toBe('3.125');
    expect(formatReadoutValue(-2.3)).toBe('−2.3');
    expect(formatReadoutValue(1.23456, 3)).toBe('1.23');
    expect(formatReadoutValue(123.45, 3)).toBe('123');
  });
  it('rounds up across a boundary without spurious digits or exponents', () => {
    expect(formatReadoutValue(0.99996)).toBe('1');
    expect(formatReadoutValue(9.99996)).toBe('10');
    expect(formatReadoutValue(999.96)).toBe('1000');
    expect(formatReadoutValue(-999.96)).toBe('−1000');
    expect(formatReadoutValue(999.6, 3)).toBe('1000');
    expect(formatReadoutValue(0.0009999)).toBe('0.0009999');
  });
  it('folds negative zero', () => {
    expect(formatReadoutValue(-0)).toBe('0');
  });
  it('matches the layer formatter for large magnitudes', () => {
    expect(formatReadoutValue(0)).toBe('0');
    expect(formatReadoutValue(1234.567)).toBe('1234.57');
    expect(formatReadoutValue(59000)).toBe('59,000');
    expect(formatReadoutValue(2500000)).toBe('2,500,000');
  });
});
