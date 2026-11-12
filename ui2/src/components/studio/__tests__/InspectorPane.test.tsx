import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InspectorPane } from '../InspectorPane';
import type { StudioArtifactSummary, StudioMemberSummary } from '@/types/studio';

afterEach(cleanup);

const CACHE = '/Users/someone/Library/Caches/brainflow/remote/abc/sub-1002/same_item.nii.gz';

function pane(artifact: Partial<StudioArtifactSummary> | null) {
  render(
    <InspectorPane
      activeSet={null}
      activeMemberId="sub-1002"
      activeMember={{ id: 'sub-1002', sourcePath: CACHE } as unknown as StudioMemberSummary}
      compareCohort={null}
      activeExpression={null}
      activeArtifact={
        artifact
          ? ({ id: 'a', title: 'sub-1002', lens: 'deck', capturedAtMs: 0, ...artifact } as StudioArtifactSummary)
          : null
      }
      artifactHistory={[]}
      savedRecipes={[]}
      onSelectArtifact={vi.fn()}
      onOpenArtifact={vi.fn()}
      onRestoreArtifact={vi.fn()}
      onRestoreRecipe={vi.fn()}
      onRenameRecipe={vi.fn()}
      onDeleteRecipe={vi.fn()}
    />,
  );
}

it('shows the source by its file name, the full (cache) path only as its tooltip (C6)', () => {
  pane({ sourcePath: CACHE, recipe: 'member(sub-1002)' });
  const source = screen.getByTestId('inspector-source');
  expect(source).toHaveTextContent(/^same_item\.nii\.gz$/);
  expect(source).toHaveAttribute('title', CACHE);
  expect(document.body.textContent).not.toContain('/Library/Caches');
  // A code-like recipe is in Provenance…, not here.
  expect(screen.queryByText('Computed as')).toBeNull();
  expect(document.body.textContent).not.toContain('member(sub-1002)');
});

it('keeps "Computed as" when the recipe reads as words', () => {
  pane({ sourcePath: CACHE, recipe: 'Subject minus group mean' });
  expect(screen.getByText('Computed as')).toBeInTheDocument();
  expect(screen.getByText('Subject minus group mean')).toBeInTheDocument();
});
