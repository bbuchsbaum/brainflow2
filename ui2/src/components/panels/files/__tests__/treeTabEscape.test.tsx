import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import { FileTreeItemRow, type FileNodeData } from '../FileTreeRow';
import { findTabExit, handleTreeTabCapture } from '../treeTabEscape';

const LONG = 'sub-01_ses-pre_task-motor_run-02_space-MNI152NLin2009cAsym_desc-preproc_bold.nii.gz';

const DATA: FileNodeData[] = [
  {
    id: '/ds-motor',
    name: 'ds-motor',
    path: '/ds-motor',
    type: 'directory',
    children: [{ id: `/ds-motor/${LONG}`, name: LONG, path: `/ds-motor/${LONG}`, type: 'file' }],
  } as FileNodeData,
  { id: '/anat', name: 'anat', path: '/anat', type: 'directory', children: [] } as FileNodeData,
];

// A row renderer shaped like FileTreeRow: a tabbable-looking chevron button
// (tabIndex -1) and a fitted, aria-hidden name.
function Row({ node, style }: NodeRendererProps<FileNodeData>) {
  return (
    <div style={style}>
      <button type="button" tabIndex={-1} aria-hidden>
        &gt;
      </button>
      <span aria-hidden>…{node.data.name.slice(-12)}</span>
    </div>
  );
}

function Harness({ withEscape = true }: { withEscape?: boolean }) {
  return (
    <div>
      <button type="button">Sort ascending</button>
      <div onKeyDownCapture={withEscape ? handleTreeTabCapture : undefined}>
        <Tree<FileNodeData>
          data={DATA}
          width={300}
          height={200}
          rowHeight={24}
          openByDefault
          disableDrag
          disableDrop
          disableEdit
          renderRow={FileTreeItemRow}
        >
          {Row}
        </Tree>
      </div>
      <button type="button">Axial slice position</button>
    </div>
  );
}

describe('Files tree: Tab leaves the tree (no keyboard trap)', () => {
  it('Tab from a focused row moves to the next control after the tree; Shift+Tab to the one before', () => {
    render(<Harness />);
    const row = screen.getByRole('treeitem', { name: 'ds-motor' });
    act(() => row.focus());
    expect(row).toHaveFocus();

    const tab = fireEvent.keyDown(row, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Axial slice position' })).toHaveFocus();
    // We moved focus ourselves (jsdom has no native Tab); arborist never ran.
    expect(tab).toBe(false);

    const anat = screen.getByRole('treeitem', { name: 'anat' });
    act(() => anat.focus());
    fireEvent.keyDown(anat, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Sort ascending' })).toHaveFocus();
  });

  it('rows are named with the FULL file name, not the fitted text', () => {
    render(<Harness />);
    expect(screen.getByRole('treeitem', { name: LONG })).toBeInTheDocument();
  });

  it('findTabExit skips controls inside the tree and hidden ones', () => {
    render(
      <div>
        <button type="button">before</button>
        <div role="tree" tabIndex={0} data-testid="t">
          <button type="button">inside</button>
        </div>
        <button type="button" style={{ display: 'none' }}>
          hidden
        </button>
        <button type="button">after</button>
      </div>,
    );
    const tree = screen.getByTestId('t');
    expect(findTabExit(tree, false)?.textContent).toBe('after');
    expect(findTabExit(tree, true)?.textContent).toBe('before');
  });
});
