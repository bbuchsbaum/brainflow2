import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileTreeRow, splitDisplayName } from '../files/FileTreeRow';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs from the ui2 package root.
const rowCss = readFileSync(
  resolve(process.cwd(), 'src/components/panels/files/FileTreeRow.css'),
  'utf8',
);

vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke: vi.fn() }) }));

describe('splitDisplayName', () => {
  it('keeps short names whole', () => {
    expect(splitDisplayName('T1w.nii.gz', false)).toEqual({
      head: 'T1w.nii.gz',
      tail: null,
      stem: null,
      extension: null,
    });
  });

  it('splits without dropping characters and keeps the extension in the tail', () => {
    const name = 'MNI152_T1_2mm_brain_mask.nii.gz';
    const { head, tail } = splitDisplayName(name, false);
    expect(head + tail).toBe(name);
    expect(head.startsWith('MNI1')).toBe(true);
    expect(tail).toBe('brain_mask.nii.gz');
    expect(head).not.toContain('…');
  });

  it('separates the protected extension from the shrinkable stem', () => {
    const name = 'MNI152_T1_2mm_brain_mask.nii.gz';
    const { head, stem, extension } = splitDisplayName(name, false);
    expect(extension).toBe('.nii.gz');
    expect(stem).toBe('brain_mask');
    expect(`${head}${stem}${extension}`).toBe(name);
  });

  it('uses a single-dot extension when no compound extension matches', () => {
    const { stem, extension } = splitDisplayName('sub-01_task-rest_bold.json', false);
    expect(extension).toBe('.json');
    expect(stem).toBe('-rest_bold');
  });

  it('gives siblings that differ near the end distinct tails', () => {
    const a = splitDisplayName('MNI152_T1_2mm_brain.nii.gz', false).tail;
    const b = splitDisplayName('MNI152_T1_2mm_brain_mask.nii.gz', false).tail;
    expect(a).not.toEqual(b);
  });

  it('does not split directories', () => {
    expect(splitDisplayName('a_very_long_directory_name_here', true).tail).toBeNull();
  });
});

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rowCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing CSS rule ${selector}`);
  return match[1];
}

describe('FileTreeRow narrow-width truncation contract', () => {
  // jsdom has no layout, so the narrow-column behaviour is pinned by the
  // flex contract that produces it: head shrinks first (end ellipsis), then
  // the stem (start ellipsis via an RTL box), and the extension never shrinks.
  it('never shrinks or ellipsizes the extension', () => {
    const ext = cssBlock('.file-tree-item .file-name-ext');
    expect(ext).toMatch(/flex:\s*0 0 auto/);
    expect(ext).not.toMatch(/text-overflow/);
    expect(ext).not.toMatch(/overflow:\s*hidden/);
  });

  it('shrinks the head before the stem, and ellipsizes the stem at its start', () => {
    const head = cssBlock('.file-tree-item .file-name-head');
    const stem = cssBlock('.file-tree-item .file-name-stem');
    const headShrink = Number(head.match(/flex:\s*0 (\d+) auto/)?.[1]);
    const stemShrink = Number(stem.match(/flex:\s*0 (\d+) auto/)?.[1]);
    expect(headShrink).toBeGreaterThan(stemShrink * 1000);
    expect(head).toMatch(/min-width:\s*0/);
    expect(head).toMatch(/text-overflow:\s*ellipsis/);
    expect(stem).toMatch(/text-overflow:\s*ellipsis/);
    expect(stem).toMatch(/direction:\s*rtl/);
  });

  it('renders head, stem and extension as separate runs with a stem minimum width', () => {
    const name = 'MNI152_T1_2mm_brain_mask.nii.gz';
    const node = {
      data: { id: `/d/${name}`, path: `/d/${name}`, name, type: 'file' },
      level: 1,
      isOpen: false,
      toggle: vi.fn(),
    };
    const { container } = render(
      <FileTreeRow node={node as never} style={{}} tree={{} as never} dragHandle={() => {}} />,
    );
    const text = container.querySelector('.file-name-text') as HTMLElement;
    const runs = Array.from(text.children).map((el) => el.className);
    expect(runs).toEqual(['file-name-head', 'file-name-stem', 'file-name-ext']);
    const stem = text.querySelector('.file-name-stem') as HTMLElement;
    expect(stem.style.minWidth).toBe('3ch');
    expect(stem.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
    expect(text.querySelector('.file-name-ext')?.textContent).toBe('.nii.gz');
  });
});

describe('FileTreeRow title', () => {
  it('exposes the full file name as the row title, with type info on the badge', () => {
    const name = 'MNI152_T1_2mm_brain_mask.nii.gz';
    const node = {
      data: { id: `/d/${name}`, path: `/d/${name}`, name, type: 'file' },
      level: 1,
      isOpen: false,
      toggle: vi.fn(),
    };
    const { container } = render(
      <FileTreeRow node={node as never} style={{}} tree={{} as never} dragHandle={() => {}} />,
    );
    const row = container.querySelector('.file-tree-item') as HTMLElement;
    expect(row.title).toBe(name);
    expect(row.querySelector('.file-name')?.getAttribute('title')).toBe(name);
    expect(row.textContent).toContain(name);
    const badge = row.querySelector('.file-type-badge');
    expect(badge?.getAttribute('title')).toMatch(/NIfTI/);
  });
});
