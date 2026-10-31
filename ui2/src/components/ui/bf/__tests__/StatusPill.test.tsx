import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StatusPill, JobStatusPill } from '../StatusPill';
import { jobStateLabel } from '../helpers';
import { Chip, FilterChip } from '../Chip';
import { Notice } from '../Notice';

describe('bf StatusPill', () => {
  it('neutral states are borderless (never a FilterChip look); queued has its own glyph; 20px', () => {
    const { container, rerender } = render(<StatusPill status="queued" />);
    const pill = () => container.firstChild as HTMLElement;
    expect(pill().className).toContain('border-0');
    expect(pill().className).toContain('h-5');
    const queuedIcon = pill().querySelector('svg')!.getAttribute('class');
    rerender(<StatusPill status="running" />);
    expect(pill().className).toContain('border-0');
    expect(pill().querySelector('svg')!.getAttribute('class')).not.toEqual(queuedIcon);
    expect(pill().querySelector('svg')!.getAttribute('class')).toContain('motion-safe:animate-spin');
  });

  it('renders icon + default label with a hairline and no fill', () => {
    const { container } = render(<StatusPill status="warning" />);
    const pill = container.firstChild as HTMLElement;
    expect(pill).toHaveTextContent('Warning');
    expect(pill.querySelector('svg')).not.toBeNull();
    expect(pill.className).toContain('border');
    expect(pill.className).not.toMatch(/\bbg-/);
  });

  it('only a blocking failure gets a fill', () => {
    const { container, rerender } = render(<StatusPill status="failed" blocking />);
    expect((container.firstChild as HTMLElement).className).toContain('bg-bf-danger-soft');
    rerender(<StatusPill status="warning" blocking />);
    expect((container.firstChild as HTMLElement).className).not.toContain('bg-bf-danger-soft');
  });

  it('JobStatusPill speaks the job-state vocabulary', () => {
    const { container } = render(<JobStatusPill state="completed" />);
    const pill = container.firstChild as HTMLElement;
    expect(pill).toHaveAttribute('data-job-state', 'completed');
    expect(pill).toHaveTextContent('Completed');
    expect(pill.className).toContain('border-bf-success/40');
    expect(jobStateLabel('weird')).toBe('Weird');
  });
});

describe('bf Chip / FilterChip', () => {
  it('static chip is a borderless, unfocusable tag', () => {
    render(<Chip>Sidecar</Chip>);
    const chip = screen.getByText('Sidecar').parentElement!;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.className).not.toMatch(/\bborder\b/);
    expect(chip.className).toContain('h-5');
  });

  it('filter chip toggles aria-pressed', () => {
    const onPressedChange = vi.fn();
    render(
      <FilterChip pressed={false} count={12} onPressedChange={onPressedChange}>
        control
      </FilterChip>,
    );
    const chip = screen.getByRole('button', { name: 'control, 12' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it('pressed filter chip = the same light "on" fill as an active segment, no tab bottom edge', () => {
    render(
      <FilterChip pressed count={12} onPressedChange={() => {}}>
        control
      </FilterChip>,
    );
    const chip = screen.getByRole('button', { name: 'control, 12' });
    const cls = chip.className.split(/\s+/);
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('text-primary-foreground');
    expect(chip.className).not.toContain('inset_0_-2px');
    expect(cls).toContain('focus-visible:shadow-[0_0_0_1px_var(--bf-bg-app)]');
    // The count stays legible on the light fill (dark text, not muted grey).
    const count = chip.querySelector('.font-mono') as HTMLElement;
    expect(count.className).toContain('text-primary-foreground/70');
  });
});

describe('bf Notice', () => {
  it('is a polite status line with a severity icon', () => {
    render(<Notice severity="warning">Different spaces</Notice>);
    const n = screen.getByRole('status');
    expect(n).toHaveTextContent('Different spaces');
    expect(n).toHaveAttribute('data-severity', 'warning');
    expect(n.querySelector('svg')).not.toBeNull();
  });

  it('panel notices: left hairline, no box, an icon for every severity', () => {
    for (const severity of ['neutral', 'info', 'success', 'warning', 'danger'] as const) {
      const { unmount } = render(<Notice severity={severity}>t</Notice>);
      const n = screen.getByRole('status');
      expect(n.className).toContain('border-l-2');
      expect(n.className).not.toMatch(/(^|\s)border(\s|$)/);
      expect(n.className).not.toContain('rounded');
      expect(n.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('warning/danger text is neutral secondary; severity colour only on icon and hairline', () => {
    for (const severity of ['warning', 'danger'] as const) {
      const { unmount } = render(<Notice severity={severity}>t</Notice>);
      const n = screen.getByRole('status');
      expect(n.className).toContain('text-bf-text-secondary');
      expect(n.className).not.toContain(`text-bf-${severity}`);
      expect(n.className).toContain(`border-bf-${severity}`);
      expect(n.querySelector('svg')!.getAttribute('class')).toContain(`text-bf-${severity}`);
      unmount();
    }
  });

  it('canvas surface adds the translucent black ground', () => {
    render(
      <Notice surface="canvas" severity="info" icon={false}>
        Meta
      </Notice>,
    );
    const n = screen.getByRole('status');
    expect(n.className).toContain('bg-bf-bg-canvas/90');
    expect(n.querySelector('svg')).toBeNull();
  });
});

describe('bf Notice role handling', () => {
  it('omitted role -> status; role={undefined} or null -> no role; alert stays explicit', () => {
    const { rerender, container } = render(<Notice>a</Notice>);
    const el = () => container.firstChild as HTMLElement;
    expect(el()).toHaveAttribute('role', 'status');
    rerender(<Notice role={undefined}>a</Notice>);
    expect(el()).not.toHaveAttribute('role');
    rerender(<Notice role={null}>a</Notice>);
    expect(el()).not.toHaveAttribute('role');
    rerender(<Notice role="alert" severity="danger">a</Notice>);
    expect(el()).toHaveAttribute('role', 'alert');
  });
});

describe('bf Chip onRemove', () => {
  it('adds a 24px remove button named "Remove <label>"; the tag stays unfocusable', () => {
    const onRemove = vi.fn();
    render(<Chip onRemove={onRemove}>sub-01</Chip>);
    const btn = screen.getByRole('button', { name: 'Remove sub-01' });
    expect(btn.className).toContain('h-6');
    expect(btn.className).toContain('w-6');
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByText('sub-01').closest('[tabindex]')).toBeNull();
  });

  it('removeLabel / removeAriaLabel name non-text chips; no button without onRemove', () => {
    const { rerender } = render(
      <Chip onRemove={() => {}} removeLabel="scope S001">
        <span>Scope</span> S001
      </Chip>,
    );
    expect(screen.getByRole('button', { name: 'Remove scope S001' })).toBeInTheDocument();
    rerender(<Chip onRemove={() => {}} removeAriaLabel="Clear filter">x</Chip>);
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
    rerender(<Chip>x</Chip>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
