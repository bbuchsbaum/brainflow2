import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioStrip } from '../StudioStrip';

afterEach(cleanup);

describe('StudioStrip population feedback', () => {
  it('explains hidden focus while allowing another individual to be focused', () => {
    const onSelectMember = vi.fn();
    render(
      <StudioStrip memberIds={['S002']} activeMemberId="S001" onSelectMember={onSelectMember} />,
    );
    expect(screen.getByRole('status').textContent).toContain('S001');
    expect(screen.getByRole('status').textContent).toContain('hidden by list filters');
    fireEvent.click(screen.getByRole('button', { name: 'S002' }));
    expect(onSelectMember).toHaveBeenCalledWith('S002');
  });

  it('shows the metadata error instead of suggesting focus is only hidden by search', () => {
    render(
      <StudioStrip
        memberIds={[]}
        activeMemberId="S001"
        contextIssue="Metadata is incomplete."
        onSelectMember={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Metadata is incomplete.');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
