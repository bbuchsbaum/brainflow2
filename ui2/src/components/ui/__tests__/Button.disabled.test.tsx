import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button primary disabled', () => {
  it('drops the light primary fill and the 50% fade (contrast 1.16:1 before)', () => {
    render(
      <Button variant="primary" disabled>
        Compute
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Compute' });
    expect(button.className).toContain('disabled:bg-bf-bg-panel-raised');
    expect(button.className).toContain('disabled:text-bf-text-muted');
    expect(button.className).toContain('disabled:opacity-100');
    expect(button.className).not.toContain('disabled:opacity-50');
  });
});
