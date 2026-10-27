import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ColorInput, NumberField, Select, TextArea, TextField } from '..';

/** The element that draws the visible field box. */
const box = (el: HTMLElement) => (el.tagName === 'INPUT' && el.getAttribute('type') === 'number' ? el.parentElement! : el);

describe('one border token for every field-like control', () => {
  it('TextField, NumberField, Select, TextArea and ColorInput share --bf-border-field (+ brighter muted on hover)', () => {
    render(
      <>
        <TextField aria-label="text" />
        <NumberField aria-label="number" />
        <Select aria-label="select" options={[{ value: 'a', label: 'A' }]} />
        <TextArea aria-label="area" />
        <ColorInput aria-label="colour" value="#ffffff" onChange={() => {}} />
      </>,
    );
    for (const name of ['text', 'number', 'select', 'area', 'colour']) {
      const cls = box(screen.getByLabelText(name)).className;
      // Select carries the token with `.bf-select` in the selector, so it
      // outranks the global select reset (theme.css).
      const prefix = name === 'select' ? '[&.bf-select]:' : '';
      const hover = name === 'select' ? '[&.bf-select:hover]:' : 'hover:';
      expect(cls.split(/\s+/), name).toContain(`${prefix}border-bf-border-field`);
      expect(cls.split(/\s+/), name).toContain(`${hover}border-bf-text-muted`);
      expect(cls, name).not.toMatch(/border-bf-border-subtle/);
    }
  });

  it('invalid Select swaps to the danger border', () => {
    render(<Select aria-label="select" invalid options={[{ value: 'a', label: 'A' }]} />);
    const cls = screen.getByLabelText('select').className.split(/\s+/);
    expect(cls).toContain('[&.bf-select]:border-bf-danger');
    expect(cls).not.toContain('[&.bf-select]:border-bf-border-field');
  });
});

describe('NumberField wheel guard', () => {
  it('cancels wheel only while the field is focused (no silent value nudges)', () => {
    render(<NumberField aria-label="x" defaultValue={-0.5} step={0.1} />);
    const input = screen.getByLabelText('x') as HTMLInputElement;
    const wheel = () => {
      const ev = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    // Unfocused: the wheel is left alone so the page/panel scrolls.
    expect(wheel()).toBe(false);
    input.focus();
    expect(wheel()).toBe(true);
    expect(input.value).toBe('-0.5');
    input.blur();
    expect(wheel()).toBe(false);
  });

  it('still forwards object and callback refs', () => {
    const objRef = React.createRef<HTMLInputElement>();
    let cbEl: HTMLInputElement | null = null;
    render(
      <>
        <NumberField aria-label="a" ref={objRef} />
        <NumberField aria-label="b" ref={(el) => { cbEl = el; }} />
      </>,
    );
    expect(objRef.current).toBe(screen.getByLabelText('a'));
    expect(cbEl).toBe(screen.getByLabelText('b'));
  });
});
