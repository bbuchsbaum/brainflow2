import { describe, expect, it } from 'vitest';
import { cn } from '../cn';

describe('cn', () => {
  it('keeps a text colour when merged with a bf type-scale size', () => {
    expect(cn('text-primary-foreground', 'text-bf-xs')).toBe('text-primary-foreground text-bf-xs');
    expect(cn('text-bf-sm text-muted-foreground')).toBe('text-bf-sm text-muted-foreground');
  });

  it('lets a later bf size override an earlier size', () => {
    expect(cn('text-sm', 'text-bf-xs')).toBe('text-bf-xs');
    expect(cn('text-bf-md', 'text-bf-2xs')).toBe('text-bf-2xs');
  });

  it('keeps role sizes separate from colours', () => {
    expect(cn('text-foreground', 'text-role-label')).toBe('text-foreground text-role-label');
  });
});
