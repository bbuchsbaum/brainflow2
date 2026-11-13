import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StudioStrip } from '../StudioStrip';

afterEach(cleanup);

const ids = ['sub-1002', 'sub-1003'];

describe('StudioStrip in the Population lens (showMembers false)', () => {
  it('renders nothing when it has no context to say: the montage and Summary are the navigation', () => {
    render(<StudioStrip memberIds={ids} activeMemberId="sub-1002" onSelectMember={vi.fn()} showMembers={false} />);
    expect(screen.queryByRole('region', { name: 'Set studio strip' })).toBeNull();
    expect(screen.queryByRole('listbox', { name: 'Members' })).toBeNull();
  });

  it('keeps its context (filters, issues) without the member cards', () => {
    render(
      <StudioStrip
        memberIds={ids}
        activeMemberId="sub-1002"
        onSelectMember={vi.fn()}
        filterLabels={['group=A']}
        contextIssue="Two members are missing."
        showMembers={false}
      />,
    );
    expect(screen.getByRole('region', { name: 'Set studio strip' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Two members are missing.');
    expect(screen.queryByRole('listbox', { name: 'Members' })).toBeNull();
  });

  it('elsewhere lists the members as before', () => {
    render(<StudioStrip memberIds={ids} activeMemberId="sub-1002" onSelectMember={vi.fn()} />);
    expect(screen.getByRole('listbox', { name: 'Members' })).toBeInTheDocument();
  });
});
