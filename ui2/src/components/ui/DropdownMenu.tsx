import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { cn } from '@/utils/cn';

export type DropdownMenuItem =
  | {
      id: string;
      separator: true;
    }
  | {
      id: string;
      label: React.ReactNode;
      icon?: React.ReactNode;
      disabled?: boolean;
      danger?: boolean;
      separator?: false;
      onClick?: () => void;
    };

interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownMenuItem[];
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  className?: string;
  onItemClick?: (item: DropdownMenuItem) => void;
}

type PopoverPlacement = {
  align: 'start' | 'end';
  side: 'top' | 'bottom';
};

const POSITION_TO_POPOVER: Record<NonNullable<DropdownMenuProps['position']>, PopoverPlacement> = {
  'bottom-left': { side: 'bottom', align: 'start' },
  'bottom-right': { side: 'bottom', align: 'end' },
  'top-left': { side: 'top', align: 'start' },
  'top-right': { side: 'top', align: 'end' },
};

function renderTrigger(trigger: React.ReactNode, isOpen: boolean) {
  if (React.isValidElement(trigger)) {
    return React.cloneElement(trigger as React.ReactElement<any>, {
      'aria-haspopup': 'menu',
      'aria-expanded': isOpen,
    });
  }

  return (
    <button
      type="button"
      className="inline-flex items-center"
      aria-haspopup="menu"
      aria-expanded={isOpen}
    >
      {trigger}
    </button>
  );
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  trigger,
  items,
  position = 'bottom-left',
  className = '',
  onItemClick,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const placement = POSITION_TO_POPOVER[position];

  const menuItems = useMemo(
    () =>
      items.map((item) => {
        if (item.separator) {
          return (
            <hr key={item.id} className="my-1 border-border" role="separator" />
          );
        }

        const toneClass = item.disabled
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : item.danger
            ? 'text-destructive hover:bg-destructive/10'
            : 'text-popover-foreground hover:bg-accent';

        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left text-sm transition-colors outline-none',
              toneClass
            )}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) {
                return;
              }

              item.onClick?.();
              onItemClick?.(item);
              setIsOpen(false);
            }}
          >
            {item.icon && (
              <span className="flex h-4 w-4 items-center justify-center">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        );
      }),
    [items, onItemClick]
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {renderTrigger(trigger, isOpen)}
      </PopoverTrigger>
      <PopoverContent
        side={placement.side}
        align={placement.align}
        sideOffset={6}
        className={cn('z-50 min-w-48 p-1', className)}
        role="menu"
        aria-orientation="vertical"
      >
        {menuItems}
      </PopoverContent>
    </Popover>
  );
};
