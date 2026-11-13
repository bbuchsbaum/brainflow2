import { describe, expect, it } from 'vitest';
import { parseNameFilter } from '../nameFilter';

const NAMES = [
  'contrast-mod_cue_old_tfce.nii.gz',
  'contrast-mod_probe_old_tfce.nii.gz',
  'contrast-mod_cue_old_t_g.nii.gz',
  'contrast-xold_cue_old_fwer.nii.gz',
  'Mask.nii',
];
const keep = (query: string) => NAMES.filter(parseNameFilter(query).matches);

describe('parseNameFilter', () => {
  it('matches everything when empty or still being typed', () => {
    for (const query of ['', '   ', '-', '*', ' - * ']) {
      expect(parseNameFilter(query).empty).toBe(true);
      expect(keep(query)).toEqual(NAMES);
    }
  });

  it('matches a substring without regard to case', () => {
    expect(keep('TFCE')).toEqual([NAMES[0], NAMES[1]]);
    expect(keep('mask')).toEqual(['Mask.nii']);
  });

  it('requires every term', () => {
    expect(keep('cue tfce')).toEqual([NAMES[0]]);
  });

  it('excludes terms that start with a minus', () => {
    expect(keep('cue -probe -fwer')).toEqual([NAMES[0], NAMES[2]]);
    expect(keep('-contrast')).toEqual(['Mask.nii']);
  });

  it('treats * as a wildcard and other punctuation literally', () => {
    expect(keep('mod*tfce')).toEqual([NAMES[0], NAMES[1]]);
    expect(keep('tfce*mod')).toEqual([]);
    expect(keep('.nii.gz')).toHaveLength(4);
    expect(keep('t_g.')).toEqual([NAMES[2]]);
    expect(keep('(')).toEqual([]);
  });

  it('stays fast for a long run of wildcards', () => {
    const filter = parseNameFilter(`a${'*'.repeat(60)}b`);
    const started = performance.now();
    expect(filter.matches('a'.repeat(60))).toBe(false);
    expect(filter.matches(`${'a'.repeat(60)}b`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('matches wildcard pieces in order without overlap', () => {
    expect(parseNameFilter('ab*bc').matches('abc')).toBe(false);
    expect(parseNameFilter('ab*bc').matches('abbc')).toBe(true);
    expect(parseNameFilter('*tfce*').matches('x_tfce.nii')).toBe(true);
  });

  it('keeps a hyphen inside a term as text', () => {
    expect(keep('contrast-mod')).toHaveLength(3);
  });
});
