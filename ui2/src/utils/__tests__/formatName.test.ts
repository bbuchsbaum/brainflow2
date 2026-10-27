import { describe, expect, it } from 'vitest';
import { fileExtension, formatName } from '../formatName';

describe('fileExtension', () => {
  it('recognises compound and simple extensions; directories have none', () => {
    expect(fileExtension('MNI152_T1_2mm_brain.nii.gz')).toBe('.nii.gz');
    expect(fileExtension('lh.pial.surf.gii')).toBe('.surf.gii');
    expect(fileExtension('sub-01_task-rest_bold.json')).toBe('.json');
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('derivatives.v2', true)).toBe('');
  });
});

describe('formatName', () => {
  it('returns names that fit unchanged', () => {
    expect(formatName('T1w.nii.gz', 20)).toBe('T1w.nii.gz');
  });

  it('cuts the middle of the stem and keeps the extension whole', () => {
    const out = formatName('MNI152_T1_2mm_brain.nii.gz', 20);
    expect(Array.from(out).length).toBeLessThanOrEqual(20);
    expect(out.endsWith('brain.nii.gz')).toBe(true);
    expect(out.startsWith('MNI')).toBe(true);
    expect(out).toContain('…');
    // never the head-only form seen in the Files tree ("MN… _2mm_brain.nii.gz")
    expect(out).not.toMatch(/…[_\s]/);
  });

  it('keeps siblings that differ near the end distinct', () => {
    const a = formatName('MNI152_T1_2mm_brain.nii.gz', 22);
    const b = formatName('MNI152_T1_2mm_brain_mask.nii.gz', 22);
    expect(a).not.toEqual(b);
    expect(b.endsWith('mask.nii.gz')).toBe(true);
  });

  it('falls back to end truncation when the extension cannot fit', () => {
    const out = formatName('sub-01_ses-01_T1w.nii.gz', 8);
    expect(Array.from(out)).toHaveLength(8);
    expect(out.endsWith('…')).toBe(true);
  });

  it('directories truncate in the middle without an extension', () => {
    const out = formatName('sub-01_ses-baseline_derivatives', 16, { isDir: true });
    expect(Array.from(out).length).toBeLessThanOrEqual(16);
    expect(out).toContain('…');
  });
});

describe('formatName keep: "tail"', () => {
  const name = 'MNI152_T1_2mm_brain_mask.nii.gz';
  it('keeps "…brain_mask.nii.gz" at 18 characters', () => {
    expect(formatName(name, 18, { keep: 'tail' })).toBe('…brain_mask.nii.gz');
  });
  it('stays tail-only (no head) through the 14-18 range and keeps the extension', () => {
    for (let n = 14; n <= 18; n += 1) {
      const out = formatName(name, n, { keep: 'tail' });
      expect(Array.from(out).length).toBeLessThanOrEqual(n);
      expect(out.startsWith('…')).toBe(true);
      expect(out.endsWith('mask.nii.gz')).toBe(true);
    }
  });
  it('adds a short head once the budget allows it', () => {
    const out = formatName(name, 26, { keep: 'tail' });
    expect(out.startsWith('MNI')).toBe(true);
    expect(out.endsWith('2mm_brain_mask.nii.gz')).toBe(true);
    expect(Array.from(out).length).toBeLessThanOrEqual(26);
  });
  it('drops a separator next to the ellipsis', () => {
    // budget 11: tail "_brain_mask" -> "brain_mask"
    expect(formatName(name, 19, { keep: 'tail' })).toBe('…brain_mask.nii.gz');
  });
  it('leaves fitting names and the balanced default unchanged', () => {
    expect(formatName('brain.nii.gz', 20, { keep: 'tail' })).toBe('brain.nii.gz');
    expect(formatName(name, 18)).toBe(formatName(name, 18, { keep: 'balanced' }));
  });
});

describe('formatName balanced mode is word-aware', () => {
  it('keeps the stem head and cuts on separators when one is within 3 characters', () => {
    expect(formatName('MNI152_T1_2mm_brain.nii.gz', 20)).toBe('MNI152…brain.nii.gz');
    expect(formatName('MNI152_T1_2mm_brain_mask.nii.gz', 26)).toBe('MNI152…brain_mask.nii.gz');
    expect(formatName('sub-01_ses-01_task-rest_bold.nii.gz', 18)).toBe('sub-01…bold.nii.gz');
  });
  it('never splits a word next to the ellipsis when a boundary is reachable', () => {
    for (const n of [18, 20, 22, 24, 26]) {
      const out = formatName('MNI152_T1_2mm_brain_mask.nii.gz', n);
      expect(Array.from(out).length).toBeLessThanOrEqual(n);
      expect(out.startsWith('MNI')).toBe(true);
      expect(out.endsWith('.nii.gz')).toBe(true);
      const [head, rest] = out.split('…');
      const stem = 'MNI152_T1_2mm_brain_mask';
      // head ends at a word end, tail starts at a word start
      expect(['', '_', '.'].includes(stem.charAt(head.length)) || stem.charAt(head.length) === '_').toBe(true);
      const tail = rest.replace(/\.nii\.gz$/, '');
      expect(stem.charAt(stem.length - tail.length - 1)).toBe('_');
    }
  });
  it('still cuts mid-word when no separator is close (no information thrown away)', () => {
    const out = formatName('averylongstemwithoutseparators.nii.gz', 20);
    expect(Array.from(out).length).toBe(20);
    expect(out).toContain('…');
  });
});

describe("formatName keep: 'auto' (Files tree)", () => {
  const mask = 'MNI152_T1_2mm_brain_mask.nii.gz';
  const brain = 'MNI152_T1_2mm_brain.nii.gz';
  it('14 chars: the head stays, the extension goes first (v2 critics)', () => {
    expect(formatName(mask, 14, { keep: 'auto' })).toBe('MNI152_T1…mask');
    expect(formatName(brain, 14, { keep: 'auto' })).toBe('MNI152_T…brain');
    // The two siblings stay distinct and keep their distinguishing word.
    expect(formatName(mask, 14, { keep: 'auto' })).not.toBe(formatName(brain, 14, { keep: 'auto' }));
  });
  it('16 chars: head token + tail token, with the extension when it fits', () => {
    expect(formatName('tmap_synthetic_df24.nii.gz', 16, { keep: 'auto' })).toBe('tmap…df24.nii.gz');
    expect(formatName('sub-01_task-rest_bold.nii.gz', 16, { keep: 'auto' })).toBe('sub…bold.nii.gz');
    // No room for the extension: as much head as fits, then the tail token.
    expect(formatName('atlas-synth3_dseg.nii.gz', 16, { keep: 'auto' })).toBe('atlas-synth…dseg');
    // A stem that fits whole drops only the extension.
    expect(formatName('atlas_dseg.nii.gz', 12, { keep: 'auto' })).toBe('atlas_dseg');
    // Siblings that differ only at the head stay distinct.
    expect(formatName('zmap_synthetic.nii.gz', 12, { keep: 'auto' })).toBe('zmap_synthe…');
    expect(formatName('tmap_synthetic.nii.gz', 12, { keep: 'auto' })).toBe('tmap_synthe…');
  });
  it('18 chars: middle mode, word-aware (head kept, cut on separators)', () => {
    const out = formatName(mask, 18, { keep: 'auto' });
    expect(out).toBe(formatName(mask, 18));
    expect(Array.from(out).length).toBeLessThanOrEqual(18);
    expect(out.startsWith('MNI')).toBe(true);
    expect(out.endsWith('mask.nii.gz')).toBe(true);
  });
  it('18 chars: auto keeps the head even when the cut splits a word (v2 critics)', () => {
    expect(formatName(brain, 18)).toBe('MNI15…brain.nii.gz');
    expect(formatName(brain, 18, { keep: 'auto' })).toBe('MNI15…brain.nii.gz');
  });
  it('24 chars: middle mode keeps "MNI152…brain_mask.nii.gz"', () => {
    expect(formatName(mask, 24, { keep: 'auto' })).toBe('MNI152…brain_mask.nii.gz');
  });
  it('keeps the head when not even the last token fits', () => {
    const out = formatName('subject_verylongtokenname.nii.gz', 12, { keep: 'auto' });
    expect(Array.from(out).length).toBeLessThanOrEqual(12);
    expect(out.startsWith('subject')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });
});
