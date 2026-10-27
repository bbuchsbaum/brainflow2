import { cva } from 'class-variance-authority';
import { cn } from '@/utils/cn';
import { FOCUS_RING_INSET, FOCUS_RING_INSET_BORDERED, SELECTED } from './states';

/** The row/card state classes, for composites that cannot render a SelectableRow. */
export const rowVariants = cva(
  'relative flex min-w-0 cursor-default items-center gap-2 text-bf-sm',
  {
    variants: {
      variant: {
        row: cn('min-h-6 py-0.5 pr-2', FOCUS_RING_INSET),
        card: cn(
          'flex-col items-stretch gap-1 rounded-sm border border-bf-border-subtle px-3 py-2',
          FOCUS_RING_INSET_BORDERED,
        ),
      },
      selected: {
        true: SELECTED,
        false:
          'text-bf-text-secondary hover:bg-bf-bg-hover hover:text-foreground data-[force-hover]:bg-bf-bg-hover data-[force-hover]:text-foreground',
      },
      disabled: { true: 'pointer-events-none opacity-50', false: '' },
    },
    defaultVariants: { variant: 'row', selected: false, disabled: false },
  },
);
