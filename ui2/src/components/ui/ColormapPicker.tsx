import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { cn } from '@/utils/cn';
import { colormaps } from './colormapOptions';

export type ColormapPickerVariant = 'default' | 'enhanced';

interface ColormapPickerProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  variant?: ColormapPickerVariant;
}

export function ColormapPicker({
  value,
  disabled = false,
  onChange,
  variant = 'default',
}: ColormapPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedColormap = useMemo(
    () => colormaps.find((colormap) => colormap.name === value) ?? colormaps[0],
    [value]
  );

  const isEnhanced = variant === 'enhanced';

  return (
    <div className={cn(isEnhanced ? 'relative mb-3' : 'colormap-selector relative')}>
      {isEnhanced ? (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-bf-xs font-medium text-muted-foreground">
            Colormap
          </span>
          <span className="text-bf-xs font-mono text-bf-text-secondary">
            {selectedColormap.label}
          </span>
        </div>
      ) : (
        <label className="mb-1 block text-bf-xs font-medium text-muted-foreground">Colormap</label>
      )}

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          {isEnhanced ? (
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'h-6 w-full overflow-hidden border transition-colors',
                'rounded-sm border-border',
                'hover:border-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
              style={{ background: selectedColormap.gradient }}
              aria-label={`Select colormap. Current colormap is ${selectedColormap.label}`}
            />
          ) : (
            <button
              type="button"
              disabled={disabled}
              aria-label={`Select colormap. Current colormap is ${selectedColormap.label}`}
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-sm border border-border bg-bf-bg-input px-2.5 text-bf-sm text-foreground',
                'hover:border-bf-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <div
                className="h-4 flex-1 rounded-sm border border-border"
                style={{ background: selectedColormap.gradient }}
              />
              <span className="text-foreground">{selectedColormap.label}</span>
              <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </PopoverTrigger>

        {isEnhanced ? (
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="z-50 min-w-[320px] border-border bg-popover p-3"
            aria-label="Select colormap"
          >
            <div className="grid max-h-[200px] grid-cols-4 gap-2 overflow-y-auto scrollbar-thin">
              {colormaps.map((colormap) => {
                const isSelected = colormap.name === value;

                return (
                  <button
                    key={colormap.name}
                    type="button"
                    aria-pressed={isSelected}
                    className={cn(
                      'group relative rounded-sm p-1 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                      isSelected
                        ? 'bg-bf-bg-selected outline outline-2 outline-primary -outline-offset-2'
                        : 'hover:bg-accent'
                    )}
                    onClick={() => {
                      onChange(colormap.name);
                      setIsOpen(false);
                    }}
                  >
                    <div
                      className="h-4 w-12 rounded-sm"
                      style={{ background: colormap.gradient }}
                    />
                    <span className="mt-1 block truncate text-bf-2xs text-foreground">
                      {colormap.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        ) : (
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] max-h-60 overflow-y-auto p-0"
            align="start"
            sideOffset={4}
            role="listbox"
            aria-label="Colormap options"
          >
            {colormaps.map((colormap) => {
              const isSelected = colormap.name === value;

              return (
                <button
                  key={colormap.name}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-bf-sm text-foreground focus:outline-none focus-visible:bg-accent focus-visible:shadow-[inset_2px_0_0_var(--bf-accent)]',
                    isSelected ? 'bg-bf-bg-selected' : 'hover:bg-accent'
                  )}
                  onClick={() => {
                    onChange(colormap.name);
                    setIsOpen(false);
                  }}
                >
                  <div
                    className="h-4 w-16 rounded-sm border border-border"
                    style={{ background: colormap.gradient }}
                  />
                  <span className="flex-1">{colormap.label}</span>
                  {isSelected && (
                    <svg className="h-4 w-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}
