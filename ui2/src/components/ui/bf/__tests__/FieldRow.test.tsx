import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldRow } from '../FieldRow';
import { KeyValue } from '../KeyValue';
import { NumberField, Select, Switch, TextField } from '../Fields';
import { splitUnit } from '../helpers';
import { installNumericInputGuard } from '@/utils/numericInput';

describe('bf FieldRow', () => {
  it('links the label to the control and uses a named label column', () => {
    const { container } = render(
      <FieldRow label="Blend mode" controlId="blend" labelWidth="wide">
        <select id="blend">
          <option>Alpha</option>
        </select>
      </FieldRow>,
    );
    expect(screen.getByLabelText('Blend mode')).toBeInstanceOf(HTMLSelectElement);
    expect((container.firstChild as HTMLElement).style.gridTemplateColumns).toBe('148px minmax(0, 1fr)');
  });

  it('labels the control even without controlId (generated id)', () => {
    render(
      <FieldRow label="Origin x">
        <NumberField defaultValue={-37.5} />
      </FieldRow>,
    );
    const input = screen.getByLabelText('Origin x');
    expect(input).toHaveAttribute('type', 'number');
    expect(input.id).toMatch(/^bf-field-/);
  });

  it('wires describedby / invalid onto the control and announces the error', () => {
    const { container, rerender } = render(
      <FieldRow label="X" hint="World mm">
        <TextField />
      </FieldRow>,
    );
    const input = screen.getByRole('textbox', { name: 'X' });
    expect(input).toHaveAccessibleDescription('World mm');
    expect(input).not.toHaveAttribute('aria-invalid');
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    rerender(
      <FieldRow label="X" hint="World mm" error="Must be between −90 and 90">
        <TextField />
      </FieldRow>,
    );
    expect(input).toHaveAccessibleDescription('Must be between −90 and 90');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The error renders inside the live region that existed before it appeared.
    expect(live).toHaveTextContent('Must be between −90 and 90');
    expect(container.firstChild).toHaveAttribute('data-invalid');
  });

  it('disabled disables the control, not only the label', () => {
    render(
      <FieldRow label="Origin z" disabled>
        <NumberField defaultValue={17.5} />
      </FieldRow>,
    );
    expect(screen.getByLabelText('Origin z')).toBeDisabled();
  });

  it('render-prop children receive the wiring', () => {
    render(
      <FieldRow label="Path" error="Missing">
        {(p) => (
          <span>
            <input {...p} />
          </span>
        )}
      </FieldRow>,
    );
    const input = screen.getByLabelText('Path');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Missing');
  });

  it('controls start at the label column (no right alignment) and take a unit suffix', () => {
    const { container } = render(
      <FieldRow label="Smoothing" unit="mm">
        <NumberField defaultValue={6} />
      </FieldRow>,
    );
    expect(container.innerHTML).not.toContain('justify-end');
    expect(screen.getByText('mm')).toBeInTheDocument();
  });

  it('hint is AA (muted-foreground, not faint)', () => {
    render(
      <FieldRow label="Path" layout="stacked" hint="Relative to the dataset">
        <TextField />
      </FieldRow>,
    );
    const hint = screen.getByText('Relative to the dataset');
    expect(hint.className).toContain('text-muted-foreground');
    expect(hint.className).not.toContain('text-bf-text-faint');
  });

  it('a pasted display minus becomes a negative number', () => {
    const uninstall = installNumericInputGuard(document);
    render(
      <FieldRow label="Origin x">
        <NumberField />
      </FieldRow>,
    );
    const input = screen.getByLabelText('Origin x') as HTMLInputElement;
    input.focus();
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: () => string };
    };
    paste.clipboardData = { getData: () => '−37.5' };
    input.dispatchEvent(paste);
    expect(input.value).toBe('-37.5');
    uninstall();
  });
});

describe('bf fields', () => {
  it('NumberField: unit suffix outside the editable text; onValueChange parses', () => {
    const values: Array<number | null> = [];
    render(<NumberField aria-label="Smoothing" unit="mm" onValueChange={(v) => values.push(v)} />);
    const input = screen.getByLabelText('Smoothing') as HTMLInputElement;
    expect(input).toHaveAttribute('data-numeric', 'true');
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '6' } });
    expect(values).toEqual([6]);
    expect(screen.getByText('mm')).toHaveAttribute('aria-hidden', 'true');
  });

  it('Select and Switch', () => {
    const picks: string[] = [];
    let checked = false;
    render(
      <>
        <Select
          aria-label="Mark"
          options={[
            { value: 'line', label: 'Line' },
            { value: 'point', label: 'Point' },
          ]}
          onValueChange={(v) => picks.push(v)}
        />
        <Switch checked={false} onCheckedChange={(c) => (checked = c)}>
          Visible
        </Switch>
      </>,
    );
    fireEvent.change(screen.getByLabelText('Mark'), { target: { value: 'point' } });
    expect(picks).toEqual(['point']);
    const sw = screen.getByRole('switch', { name: 'Visible' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(checked).toBe(true);
    expect(sw.className).toContain('h-6');
  });
});

describe('bf KeyValue', () => {
  it('is a description list with mono values (ids too) and units kept apart from numbers', () => {
    render(
      <KeyValue
        items={[
          { label: 'Shape', value: '91 × 109 × 91' },
          { label: 'Voxel size', value: '2.00 mm' },
          { label: 'Space', value: 'MNI152NLin2009cAsym' },
          { label: 'Note', value: 'Linked to the crosshair', mono: false },
        ]}
      />,
    );
    const terms = screen.getAllByRole('term');
    expect(terms.map((t) => t.textContent)).toEqual(['Shape', 'Voxel size', 'Space', 'Note']);
    expect(terms[0]).toHaveAttribute('title', 'Shape');
    expect(screen.getByText('mm')).toBeInTheDocument();
    expect(screen.getByText('2.00')).toBeInTheDocument();
    expect(screen.getByText('MNI152NLin2009cAsym').closest('[title]')?.className).toContain('font-mono');
    expect(screen.getByText('Linked to the crosshair').closest('[title]')?.className).not.toContain('font-mono');
    // a long value takes the full row
    expect(screen.getByText('MNI152NLin2009cAsym').closest('dd')?.parentElement?.className).toContain('col-span-2');
  });

  it('splitUnit only splits known trailing units', () => {
    expect(splitUnit('2.00 mm')).toEqual(['2.00', 'mm']);
    expect(splitUnit('2 s')).toEqual(['2', 's']);
    expect(splitUnit('sub 01')).toEqual(['sub 01', null]);
  });

  it('rows layout pairs dt/dd in a named label column', () => {
    const { container } = render(<KeyValue layout="rows" labelWidth="wide" items={[{ label: 'TR', value: 2, unit: 's' }]} />);
    expect((container.firstChild as HTMLElement).style.gridTemplateColumns).toBe('148px minmax(0, 1fr)');
    expect(screen.getByRole('definition')).toHaveTextContent('2s');
  });
});

describe('bf FieldRow with non-labelable controls', () => {
  it('names a Slider root by aria-labelledby (no <label for> to a div); thumbs keep their names', async () => {
    const { Slider } = await import('../Slider');
    const { container } = render(
      <FieldRow label="Opacity" controlId="op">
        <Slider label="Layer opacity" min={0} max={1} value={0.5} onValueChange={() => {}} />
      </FieldRow>,
    );
    const label = container.querySelector('label') as HTMLLabelElement;
    expect(label).not.toHaveAttribute('for');
    expect(label.id).toBe('op-label');
    const group = screen.getByRole('group', { name: 'Opacity' });
    expect(group).toHaveAttribute('id', 'op');
    expect(screen.getByRole('slider', { name: 'Layer opacity' })).toBeInTheDocument();
  });

  it('a SegmentedControl without its own name is labelled by the row; with one it keeps it', async () => {
    const { SegmentedControl } = await import('../SegmentedControl');
    const opts = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    const { rerender } = render(
      <FieldRow label="Style" controlId="st">
        {/* @ts-expect-error the type demands a name; FieldRow supplies aria-labelledby */}
        <SegmentedControl options={opts} value="a" onValueChange={() => {}} />
      </FieldRow>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Style' })).toBeInTheDocument();
    rerender(
      <FieldRow label="Style" controlId="st">
        <SegmentedControl aria-label="Line style" options={opts} value="a" onValueChange={() => {}} />
      </FieldRow>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Line style' })).toBeInTheDocument();
  });

  it('native controls keep <label for>; `labelable={false}` switches a render function to aria-labelledby', () => {
    const { container, rerender } = render(
      <FieldRow label="Name" controlId="nm">
        <TextField />
      </FieldRow>,
    );
    expect(container.querySelector('label')).toHaveAttribute('for', 'nm');
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-labelledby');
    rerender(
      <FieldRow label="Pick" controlId="pk" labelable={false}>
        {(p) => <div role="listbox" id={p.id} aria-labelledby={p['aria-labelledby']} />}
      </FieldRow>,
    );
    expect(screen.getByRole('listbox', { name: 'Pick' })).toBeInTheDocument();
    expect(container.querySelector('label')).not.toHaveAttribute('for');
  });

  it('a TextArea is a labelable FieldRow control (mono, invalid)', async () => {
    const { TextArea } = await import('../Fields');
    render(
      <FieldRow label="JSON" controlId="js" error="Invalid JSON">
        <TextArea mono defaultValue="{}" />
      </FieldRow>,
    );
    const ta = screen.getByRole('textbox', { name: 'JSON' });
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta).toHaveAttribute('aria-invalid', 'true');
    expect(ta).toHaveAttribute('aria-describedby', 'js-error');
    expect(ta.className).toContain('font-mono');
  });
});

describe('bf KeyValue wrap', () => {
  it('wraps values instead of truncating and lays out node lists', () => {
    const { container } = render(
      <KeyValue
        columns={1}
        wrap
        items={[
          { label: 'Inputs', value: <><span data-testid="c1">volume</span><span data-testid="c2">mask</span></> },
          { label: 'Note', value: 'a long sentence that should wrap', mono: false },
        ]}
      />,
    );
    const c1 = screen.getByTestId('c1');
    expect(c1.parentElement!.className).toContain('flex-wrap');
    expect(c1.parentElement).toBe(screen.getByTestId('c2').parentElement);
    expect(container.querySelector('dd .truncate')).toBeNull();
  });

  it('per-item wrap overrides the list default', () => {
    const { container } = render(
      <KeyValue columns={1} items={[{ label: 'A', value: 'x' }, { label: 'B', value: 'y', wrap: true }]} />,
    );
    expect(container.querySelectorAll('dd .truncate')).toHaveLength(1);
  });
});
