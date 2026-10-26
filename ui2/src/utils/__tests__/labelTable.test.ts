import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLabelPalette,
  fallbackLabelColor,
  labelSidecarCandidates,
  MAX_CATEGORICAL_LABEL,
  parseLabelTable,
} from '../labelTable';

const FIXTURE_TSV = readFileSync(
  resolve(__dirname, '../../devHarness/fixtures/app/atlas3_dseg.tsv'),
  'utf8',
);

describe('labelSidecarCandidates', () => {
  it('derives same-stem sidecars for NIfTI and MGH images', () => {
    expect(labelSidecarCandidates('/d/atlas-synth3_dseg.nii.gz')).toEqual([
      '/d/atlas-synth3_dseg.tsv',
      '/d/atlas-synth3_dseg.lut',
      '/d/atlas-synth3_dseg.txt',
    ]);
    expect(labelSidecarCandidates('/d/aparc+aseg.mgz')[0]).toBe('/d/aparc+aseg.tsv');
    expect(labelSidecarCandidates('/d/lh.white.gii')).toEqual([]);
  });
});

describe('parseLabelTable', () => {
  it('reads the BIDS dseg TSV fixture (index/name/color, extra columns ignored)', () => {
    expect(parseLabelTable(FIXTURE_TSV)).toEqual([
      { id: 1, name: 'L_sensorimotor', color: [0x46, 0x82, 0xb4] },
      { id: 2, name: 'R_occipitotemporal', color: [0xdc, 0xb4, 0x3c] },
      { id: 3, name: 'Medial_prefrontal', color: [0xb4, 0x5a, 0x8c] },
    ]);
  });

  it('reads a TSV without colours and keeps the first of duplicate ids', () => {
    const rows = parseLabelTable('index\tname\n0\tbackground\n4\tA\n4\tB\n7\tC\n');
    expect(rows).toEqual([
      { id: 0, name: 'background', color: null },
      { id: 4, name: 'A', color: null },
      { id: 7, name: 'C', color: null },
    ]);
  });

  it('reads a FreeSurfer colour LUT', () => {
    const lut = [
      '#$Id: FreeSurferColorLUT.txt $',
      '',
      '#No. Label Name:                            R   G   B   A',
      '0   Unknown                                 0   0   0   0',
      '2   Left-Cerebral-White-Matter              245 245 245 0',
      '17  Left-Hippocampus                        220 216 20  0',
    ].join('\n');
    expect(parseLabelTable(lut)).toEqual([
      { id: 0, name: 'Unknown', color: [0, 0, 0] },
      { id: 2, name: 'Left-Cerebral-White-Matter', color: [245, 245, 245] },
      { id: 17, name: 'Left-Hippocampus', color: [220, 216, 20] },
    ]);
  });

  it('returns nothing for unrelated text', () => {
    expect(parseLabelTable('subject\tage\nsub-01\t23\n')).toEqual([]);
    expect(parseLabelTable('just some notes\nabout the scan')).toEqual([]);
  });
});

describe('buildLabelPalette', () => {
  it('builds a (max + 1) * 3 LUT indexed by label id with label 0 black', () => {
    const palette = buildLabelPalette(parseLabelTable(FIXTURE_TSV));
    expect(palette.maxLabel).toBe(3);
    expect(palette.lutRgb).toEqual([0, 0, 0, 0x46, 0x82, 0xb4, 0xdc, 0xb4, 0x3c, 0xb4, 0x5a, 0x8c]);
    expect(palette.legend.map((e) => [e.label_id, e.displayName])).toEqual([
      [1, 'L_sensorimotor'],
      [2, 'R_occipitotemporal'],
      [3, 'Medial_prefrontal'],
    ]);
  });

  it('colours uncoloured labels deterministically and leaves ids past the LUT width uncoloured', () => {
    const palette = buildLabelPalette([
      { id: 5, name: 'a', color: null },
      { id: MAX_CATEGORICAL_LABEL + 10, name: 'far', color: [1, 2, 3] },
    ]);
    expect(palette.maxLabel).toBe(5);
    expect(palette.lutRgb.slice(15, 18)).toEqual(fallbackLabelColor(5));
    expect(palette.uncoloured).toEqual([MAX_CATEGORICAL_LABEL + 10]);
    expect(palette.legend).toHaveLength(2);
  });
});
