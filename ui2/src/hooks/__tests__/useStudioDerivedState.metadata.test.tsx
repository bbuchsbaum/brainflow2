import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStudioDerivedState } from '../useStudioDerivedState';

it('searches, sorts and filters metadata beyond the import preview without moving focus', () => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  const state = useSetStudioStore.getState(),
    set = state.sets[state.selection.activeSetId!];
  const ids = Array.from({ length: 100 }, (_, i) => `obs-${i}`);
  useSetStudioStore.setState({
    sets: {
      ...state.sets,
      [set.id]: {
        ...set,
        memberIds: ids,
        memberCount: ids.length,
        designColumns: ['site', 'visit'],
        designTablePreview: { columns: ['site'], rows: [{ id: ids[0], cells: ['wrong-preview'] }] },
        memberSummaries: ids.map((id, i) => ({
          id,
          sourcePath: null,
          designValues: { site: i < 80 ? 'A' : 'late-site', visit: String(i) },
        })),
      },
    },
    selection: { ...state.selection, activeMemberId: ids[0] },
  });
  const { result } = renderHook(() => useStudioDerivedState());
  expect(result.current.visibleMemberIds).toHaveLength(100);
  expect(
    result.current.quickFilterOptions.find((option) => option.column === 'site')?.values,
  ).toEqual(['A', 'late-site']);
  act(() =>
    useSetStudioStore.setState({
      designSearch: 'late-site',
      sortColumn: 'visit',
      sortDirection: 'desc',
    }),
  );
  expect(result.current.visibleMemberIds).toEqual(ids.slice(80).reverse());
  expect(useSetStudioStore.getState().selection.activeMemberId).toBe(ids[0]);
  act(() =>
    useSetStudioStore.setState({
      designSearch: '',
      activeDesignFilters: [{ column: 'site', value: 'late-site' }],
    }),
  );
  expect(result.current.population.context.memberIds).toEqual(ids.slice(80));
});
