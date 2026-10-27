import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileTreeRow, splitDisplayName } from '../files/FileTreeRow';
import { formatName } from '@/utils/formatName';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
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

// The tree now renders names through utils/formatName (middle truncation,
// extension kept whole) fitted to the measured name column by useFittedName.
// This replaces the earlier three-run (head / stem / extension) flex contract,
// whose head-first shrink produced "MN… _2mm_brain.nii.gz" at 1280px.
describe('FileTreeRow name truncation (formatName)', () => {
  it('keeps the extension and the distinctive end of the stem when cut', () => {
    const cut = formatName('MNI152_T1_2mm_brain_mask.nii.gz', 22);
    expect(cut.endsWith('.nii.gz')).toBe(true);
    expect(cut).toContain('…');
    expect(cut).toMatch(/^MNI/);
    expect(cut).toMatch(/mask\.nii\.gz$/);
    expect(Array.from(cut).length).toBeLessThanOrEqual(22);
    // Siblings that differ near the end stay distinguishable.
    expect(formatName('MNI152_T1_2mm_brain.nii.gz', 20)).not.toEqual(cut);
  });

  it('gives the name column a width independent of its text (so fitting cannot feed back)', () => {
    const text = cssBlock('.file-tree-item .file-name-text');
    expect(text).toMatch(/flex:\s*1 1 0/);
    expect(text).toMatch(/min-width:\s*0/);
    expect(text).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('renders the full name without layout (jsdom) and marks file names mono', () => {
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
    expect(text.textContent).toBe(name);
    expect(text.className).toMatch(/font-mono/);
    expect(text.getAttribute('data-full-name')).toBe(name);
  });
});

describe('FileTreeRow state geometry (SelectableRow vocabulary)', () => {
  it('gates the inset focus ring on keyboard navigation, 2px clear of the selection edge', () => {
    const rule = cssBlock(
      ".fb-tree-container[data-kbd-nav='true'] [role='treeitem']:focus > .file-tree-item",
    );
    expect(rule).toMatch(/outline:\s*2px solid var\(--bf-border-focus\)/);
    expect(rule).toMatch(/outline-offset:\s*-6px/);
  });

  it('selected rows carry the shared selected fill and amber left edge', () => {
    const name = 'a.nii.gz';
    const node = {
      data: { id: `/d/${name}`, path: `/d/${name}`, name, type: 'file' },
      level: 2,
      isOpen: false,
      toggle: vi.fn(),
    };
    useFileBrowserStore.setState({ selectedPath: `/d/${name}` });
    const { container } = render(
      <FileTreeRow node={node as never} style={{ paddingLeft: 24 }} tree={{} as never} dragHandle={() => {}} />,
    );
    const row = container.querySelector('.file-tree-item') as HTMLElement;
    expect(row.className).toContain('bg-bf-bg-active');
    expect(row.className).toContain('shadow-[inset_2px_0_0_var(--bf-accent)]');
    expect(row.style.paddingLeft).toBe('32px');
    useFileBrowserStore.setState({ selectedPath: null });
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
