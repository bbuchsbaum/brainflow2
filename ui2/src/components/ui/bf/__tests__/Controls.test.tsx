import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { Button } from '../../Button';
import { IconButton } from '../../IconButton';
import { Pager, Toolbar, ToolbarField } from '../Pager';
import { Select } from '../Fields';
import { ValueChip } from '../ValueChip';
import { FOCUS_RING } from '../states';

describe('Button / IconButton (extended, same API)', () => {
  it('keeps the old props, forwards refs and extra attributes, uses the square outer ring', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <Button ref={ref} variant="ghost" size="sm" aria-describedby="x" data-testid="b" onClick={onClick}>
        Reset
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Reset' });
    expect(ref.current).toBe(b);
    expect(b).toHaveAttribute('aria-describedby', 'x');
    expect(b.className).toContain('h-6');
    expect(b.className).toContain('focus-visible:rounded-none');
    expect(b.className).toContain('focus-visible:outline-offset-1');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });

  it('IconButton xs is a 24×24 target; pressed is a toggle', () => {
    render(<IconButton size="xs" icon={<svg />} aria-label="Visible" pressed />);
    const b = screen.getByRole('button', { name: 'Visible' });
    expect(b.className).toContain('h-6');
    expect(b.className).toContain('w-6');
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(FOCUS_RING).toContain('outline-offset-1');
  });
});

describe('Pager', () => {
  function H() {
    const [p, setP] = useState(3);
    return <Pager noun="member" page={p} count={6} onPageChange={setP} />;
  }
  it('reads "3 of 6", steps, and disables at the ends', () => {
    render(<H />);
    expect(screen.getByRole('group', { name: 'Member 3 of 6' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next member' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next member' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next member' }));
    expect(screen.getByRole('group', { name: 'Member 6 of 6' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next member' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous member' })).toBeEnabled();
  });
});

describe('Toolbar', () => {
  it('labels each control', () => {
    render(
      <Toolbar aria-label="Plot">
        <ToolbarField label="Mark">
          <Select options={[{ value: 'line', label: 'Line' }]} />
        </ToolbarField>
      </Toolbar>,
    );
    expect(screen.getByRole('group', { name: 'Plot' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mark')).toBeInstanceOf(HTMLSelectElement);
  });
});

describe('ValueChip', () => {
  it('is a 20px chip with a 24px hit area (transparent ::after, 2px above and below)', () => {
    render(<ValueChip value={1} label="Low" onCommit={() => {}} />);
    const cls = screen.getByRole('button', { name: 'Low: 1, edit' }).className.split(/\s+/);
    expect(cls).toContain('h-5');
    expect(cls).toEqual(expect.arrayContaining(['relative', 'after:absolute', 'after:-inset-y-0.5', "after:content-['']"]));
  });

  it('blur with an invalid draft reverts without committing; copy is ASCII', () => {
    const onCommit = vi.fn();
    render(<ValueChip value={-4.58} label="Low" onCommit={onCommit} />);
    const chip = screen.getByRole('button', { name: 'Low: -4.58, edit' });
    expect(chip).toHaveTextContent('−4.58');
    fireEvent.click(chip);
    const input = screen.getByRole('textbox', { name: 'Low' });
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Low: -4.58, edit' })).toBeInTheDocument();
  });

  it('clamps a committed value to [min, max]', () => {
    const onCommit = vi.fn();
    render(<ValueChip value={1} label="High" min={0} max={6} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button', { name: 'High: 1, edit' }));
    const input = screen.getByRole('textbox', { name: 'High' });
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(6);
  });
});

describe('bf Pager label', () => {
  it('names the group "<label>, <noun> n of N" and the buttons by the noun', () => {
    render(<Pager label="Observations" noun="page" page={2} count={5} onPageChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Observations, page 2 of 5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
  });
});

describe('bf Button wrap', () => {
  it('wraps long link labels (no nowrap, left aligned, breaks paths)', () => {
    render(
      <Button variant="link" size="sm" wrap>
        sub-01/anat/sub-01_T1w.nii.gz
      </Button>,
    );
    const b = screen.getByRole('button');
    expect(b.className).toContain('whitespace-normal');
    expect(b.className).not.toContain('whitespace-nowrap');
    expect(b.className).toContain('text-left');
    expect(b.className).toContain('[overflow-wrap:anywhere]');
  });

  it('a wrapping non-link button grows from 24px', () => {
    render(
      <Button variant="secondary" size="sm" wrap>
        long
      </Button>,
    );
    const b = screen.getByRole('button');
    expect(b.className).toContain('min-h-6');
    expect(b.className).toContain('h-auto');
    expect(b.className).not.toMatch(/(^| )h-6( |$)/);
  });
});

describe('bf Checkbox / ColorInput', () => {
  it('Checkbox is a native checkbox named by its children, 24px target, toggles', async () => {
    const { Checkbox } = await import('../Fields');
    const onCheckedChange = vi.fn();
    render(
      <Checkbox checked={false} onCheckedChange={onCheckedChange}>
        Combine A
      </Checkbox>,
    );
    const cb = screen.getByRole('checkbox', { name: 'Combine A' });
    expect(cb.parentElement!.className).toContain('h-6');
    expect(cb.className).toContain(FOCUS_RING.split(' ')[0]);
    fireEvent.click(screen.getByText('Combine A'));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('Checkbox without children takes FieldRow wiring', async () => {
    const { Checkbox } = await import('../Fields');
    const { FieldRow } = await import('../FieldRow');
    render(
      <FieldRow label="Aligned" controlId="al">
        <Checkbox checked onChange={() => {}} />
      </FieldRow>,
    );
    expect(screen.getByRole('checkbox', { name: 'Aligned' })).toBeChecked();
  });

  it('ColorInput: 24px colour input with focus ring, optional hex readout', async () => {
    const { ColorInput } = await import('../Fields');
    const onValueChange = vi.fn();
    const { container } = render(
      <ColorInput aria-label="Active colour" value="#ff0000" showValue onValueChange={onValueChange} />,
    );
    const input = screen.getByLabelText('Active colour') as HTMLInputElement;
    expect(input.type).toBe('color');
    expect(input.className).toContain('h-6');
    expect(input.className).toContain(FOCUS_RING.split(' ')[0]);
    expect(container.textContent).toContain('#ff0000');
    fireEvent.change(input, { target: { value: '#00ff00' } });
    expect(onValueChange).toHaveBeenCalledWith('#00ff00', expect.anything());
  });
});
