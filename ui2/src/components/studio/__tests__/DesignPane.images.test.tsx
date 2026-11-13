import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesignPane } from '../DesignPane';
import { folderSet, FOLDER_IMAGES } from '@/services/studio/__tests__/designPanelFixtures';
import type { SpatialFieldSetSummary } from '@/types/studio';

/** What the store derives today: up to six values of each of the first four columns. */
function optionsFor(set: SpatialFieldSetSummary) {
  const columns = [...set.designColumns].slice(0, 4);
  return columns.map((column) => ({
    column,
    values: [
      ...new Set(set.memberSummaries.map((member) => member.designValues?.[column] ?? '')),
    ].slice(0, 6),
  }));
}

function renderPane(set: SpatialFieldSetSummary, props: Partial<Parameters<typeof DesignPane>[0]> = {}) {
  return render(
    <DesignPane
      activeSet={set}
      cohorts={[]}
      activeMemberId={set.memberIds[1]}
      quickFilterOptions={optionsFor(set)}
      onSelectMember={vi.fn()}
      {...props}
    />,
  );
}

describe('DesignPane for a set opened from a folder', () => {
  it('never says "roles" and never shows the comma-separated list', () => {
    const { container } = renderPane(folderSet(35));
    expect(container.textContent).not.toMatch(/roles?\b/i);
    expect(container.textContent).not.toContain(FOLDER_IMAGES.join(','));
    for (const element of container.querySelectorAll('[title], [aria-label]')) {
      expect(element.getAttribute('title') ?? '').not.toMatch(/\broles?\b/i);
      expect(element.getAttribute('aria-label') ?? '').not.toMatch(/\broles?\b/i);
    }
    expect(screen.queryByRole('option', { name: /roles|images/i })).toBeNull();
  });

  it('says what the images are once, as short names with the full path in a tooltip', () => {
    renderPane(folderSet(35), { activeImage: FOLDER_IMAGES[1] });
    const summary = screen.getByTestId('design-images-summary');
    expect(summary).toHaveTextContent('35 members · 3 images each');
    const items = within(screen.getByRole('list', { name: 'Images' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'same_item',
      'same_run · shown',
      'temporal_dist',
    ]);
    expect(within(items[0]).getByTitle(FOLDER_IMAGES[0])).toBeInTheDocument();
    expect(items[1]).toHaveAttribute('aria-current', 'true');
    expect(items[0]).not.toHaveAttribute('aria-current');
    // Not controls: nothing here picks the image.
    expect(within(summary).queryByRole('button')).toBeNull();
  });

  it('keeps enough of the path when short names would collide', () => {
    const images = ['enc/maps/same_item.nii.gz', 'ret/maps/same_item.nii.gz'];
    const set = folderSet(4, Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [`sub-${1002 + index}`, images]),
    ));
    renderPane(set);
    const items = within(screen.getByRole('list', { name: 'Images' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'enc/maps/same_item',
      'ret/maps/same_item',
    ]);
    expect(within(items[1]).getByTitle(images[1])).toBeInTheDocument();
  });

  it('is a plain member list (no header row) with the selected-row treatment', () => {
    renderPane(folderSet(35));
    const list = screen.getByRole('group', { name: 'Members' });
    expect(within(list).queryByText('Member')).toBeNull();
    expect(within(list).queryByText('member')).toBeNull();
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(35);
    expect(rows[0]).toHaveTextContent(/^sub-1002$/);
    expect(rows[1].className).toContain('bg-bf-bg-active');
    expect(rows[0].className).not.toContain('bg-bf-bg-active');
    expect(screen.getByText('35 visible members')).toBeInTheDocument();
    // The sort still offers the member id, under its readable name.
    expect(screen.getByRole('option', { name: 'Member' })).toBeInTheDocument();
  });

  it('offers no filters when no column partitions the members', () => {
    renderPane(folderSet(35));
    expect(screen.queryByRole('group', { name: 'Filters' })).toBeNull();
    expect(screen.queryByText('Filters')).toBeNull();
    expect(screen.queryByRole('button', { name: 'sub-1002', pressed: false })).toBeNull();
    // Nor a "Columns" section listing only the synthesized columns.
    expect(screen.queryByText('Columns')).toBeNull();
  });

  it('shows per-member completeness, in words and weight, when members differ', () => {
    const set = folderSet(35, { 'sub-1004': FOLDER_IMAGES.slice(0, 2) });
    renderPane(set);
    expect(screen.getByTestId('design-images-summary')).toHaveTextContent(
      '35 members · 3 images · 1 incomplete',
    );
    expect(screen.getByTitle('Member')).toHaveTextContent('Member');
    expect(screen.getByTitle('Images')).toHaveTextContent('Images');
    // Sorting by images groups the incomplete members; offered only now.
    expect(screen.getByRole('option', { name: 'Images' })).toHaveValue('roles');
    expect(screen.getByRole('button', { name: /^sub-1002\s*3 of 3$/ })).toBeInTheDocument();
    const incomplete = screen.getByRole('button', { name: /^sub-1004/ });
    expect(incomplete).toHaveTextContent('2 of 3 · missing temporal_dist');
    expect(within(incomplete).getByText('2 of 3').className).toContain('font-medium');
    expect(within(incomplete).getByTitle(`Missing ${FOLDER_IMAGES[2]}`)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filters' })).toBeNull();
  });

  it('keeps quick filters for real design columns, as given', () => {
    const set = folderSet(6, {}, (index) => ({ sex: index % 2 ? 'F' : 'M', scanner: 'prisma' }));
    renderPane(set);
    const filters = screen.getByRole('group', { name: 'Filters' });
    const groups = within(filters).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['sex']);
    expect(within(filters).getByRole('button', { name: 'F' })).toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: 'M' })).toBeInTheDocument();
    // Headers: the synthesized id column reads "Member"; the user's are as given.
    expect(screen.getByTitle('Member')).toBeInTheDocument();
    expect(screen.getByTitle('sex')).toBeInTheDocument();
    expect(screen.getByTitle('scanner')).toBeInTheDocument();
    expect(screen.queryByTitle('Images')).toBeNull();
  });
});

describe('DesignPane for a table import', () => {
  const ids = ['s1', 's2', 's3', 's4'];
  const TABLE_SET: SpatialFieldSetSummary = {
    ...folderSet(0),
    id: 'table',
    name: 'Table',
    discoveryRequest: undefined,
    memberIds: ids,
    memberCount: ids.length,
    designColumns: ['subject', 'sex', 'site'],
    memberSummaries: ids.map((id, index) => ({
      id,
      sourcePath: `/t/${id}.nii`,
      designValues: { subject: id, sex: index % 2 ? 'F' : 'M', site: index < 2 ? 'a' : 'b' },
    })),
  };

  it('is unchanged: no images summary, a header row and its filters', () => {
    renderPane(TABLE_SET);
    expect(screen.queryByTestId('design-images-summary')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Members' })).toBeNull();
    for (const column of ['subject', 'sex', 'site'])
      expect(screen.getByTitle(column)).toHaveTextContent(column);
    expect(screen.getByRole('button', { name: 's1 M a' })).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: 'Filters' });
    expect(
      within(filters).getAllByRole('group').map((group) => group.getAttribute('aria-label')),
    ).toEqual(['sex', 'site']);
    expect(screen.getByText('Columns')).toBeInTheDocument();
  });
});
