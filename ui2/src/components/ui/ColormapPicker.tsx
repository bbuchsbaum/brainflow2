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
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
            Colormap
          </span>
          <span className="text-[11px] font-mono text-[var(--app-text-secondary)]">
            {selectedColormap.label}
          </span>
        </div>
      ) : (
        <label className="mb-1 block text-xs font-medium text-gray-700">Colormap</label>
      )}

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          {isEnhanced ? (
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'h-6 w-full overflow-hidden border transition-colors',
                'rounded-[1px] border-[var(--app-border)]',
                'hover:border-[var(--layer-accent)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--layer-accent)] focus-visible:ring-offset-1',
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
                'flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
                'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <div
                className="h-4 flex-1 rounded border"
                style={{ background: selectedColormap.gradient }}
              />
              <span className="text-gray-700">{selectedColormap.label}</span>
              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            className="z-50 min-w-[320px] border-[var(--layer-divider)] bg-[var(--layer-bg)] p-3"
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
                      'group relative rounded-[1px] p-1 transition-all',
                      isSelected
                        ? 'bg-[var(--layer-selected)] outline outline-2 outline-[var(--layer-accent)] outline-offset-[-2px]'
                        : 'hover:bg-[var(--layer-hover)]'
                    )}
                    onClick={() => {
                      onChange(colormap.name);
                      setIsOpen(false);
                    }}
                  >
                    <div
                      className="h-4 w-12 rounded-[1px]"
                      style={{ background: colormap.gradient }}
                    />
                    <span className="mt-1 block truncate text-[9px] uppercase tracking-wider text-[var(--layer-text)]">
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
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus:outline-none',
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50 focus:bg-gray-50'
                  )}
                  onClick={() => {
                    onChange(colormap.name);
                    setIsOpen(false);
                  }}
                >
                  <div
                    className="h-4 w-16 rounded border"
                    style={{ background: colormap.gradient }}
                  />
                  <span className="flex-1 text-gray-700">{colormap.label}</span>
                  {isSelected && (
                    <svg className="h-4 w-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
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
