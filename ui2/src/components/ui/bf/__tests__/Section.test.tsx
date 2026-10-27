import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Section } from '../Section';

describe('bf Section', () => {
  it('toggles with aria-expanded / aria-controls and hides the body', () => {
    render(
      <Section title="Render" meta="2 items">
        <p>body</p>
      </Section>,
    );
    const button = screen.getByRole('button', { name: /Render/ });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const body = document.getElementById(button.getAttribute('aria-controls')!);
    expect(body).toHaveTextContent('body');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(body).not.toBeVisible();
    expect(screen.getByRole('group', { name: 'Render' })).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('is not a landmark by default; `landmark` makes it a region', () => {
    const { rerender } = render(<Section title="Data">x</Section>);
    expect(screen.queryByRole('region')).toBeNull();
    rerender(
      <Section title="Data" landmark>
        x
      </Section>,
    );
    expect(screen.getByRole('region', { name: 'Data' })).toBeInTheDocument();
  });

  it('keepMounted preserves a draft across collapse; default unmounts', () => {
    const { rerender } = render(
      <Section title="Edit" keepMounted>
        <input aria-label="draft" defaultValue="draft" />
      </Section>,
    );
    const input = screen.getByLabelText('draft') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'edited draft' } });
    const toggle = screen.getByRole('button', { name: /Edit/ });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('edited draft');
    rerender(
      <Section title="Other" defaultOpen={false}>
        <input aria-label="gone" />
      </Section>,
    );
  });

  it('collapsed body unmounts without keepMounted', () => {
    render(
      <Section title="Lazy" defaultOpen={false}>
        <input aria-label="gone" />
      </Section>,
    );
    expect(screen.queryByLabelText('gone')).toBeNull();
  });

  it('numeric meta is mono, word meta is sans; header is 32px', () => {
    render(
      <>
        <Section title="Data" meta="91 × 109 × 91">
          x
        </Section>
        <Section title="Render" meta="volume">
          y
        </Section>
      </>,
    );
    expect(screen.getByText('91 × 109 × 91').className).toContain('font-mono');
    expect(screen.getByText('volume').className).not.toContain('font-mono');
    expect(screen.getByRole('button', { name: /Data/ }).className).toContain('h-8');
  });

  it('supports controlled open state', () => {
    const onOpenChange = vi.fn();
    render(
      <Section title="Data" open={false} onOpenChange={onOpenChange}>
        <p>body</p>
      </Section>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Data/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: /Data/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('static variant is a heading with no toggle; actions sit outside the header button', () => {
    render(
      <Section variant="static" title="Visibility" actions={<button type="button">Reset</button>}>
        <p>body</p>
      </Section>,
    );
    expect(screen.getByRole('heading', { name: 'Visibility', level: 3 })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('body')).toBeVisible();
  });
});
