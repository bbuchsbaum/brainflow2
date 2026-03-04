import React from 'react';
import type { Layer } from '@/types/layers';
import { VscInfo } from 'react-icons/vsc';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { cn } from '@/utils/cn';

interface LayerDropdownProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onShowMetadata?: (layerId: string) => void;
}

export const LayerDropdown: React.FC<LayerDropdownProps> = ({
  layers,
  selectedLayerId,
  onSelect,
  onToggleVisibility,
  onShowMetadata
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const selectedLayer = layers.find(l => l.id === selectedLayerId);

  if (layers.length === 0) {
    return (
      <div className="text-[13px] text-muted-foreground text-center py-4">
        Layer stack empty
      </div>
    );
  }

  return (
    <div className="mb-4">
      {/* Label */}
      <label className="block text-[13px] font-medium mb-2 text-foreground">
        Active Layer
      </label>
      
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "w-full h-10 px-3 flex items-center justify-between",
              "rounded-md border bg-background text-[13px]",
              "transition-all duration-200",
              "hover:bg-accent/10 hover:border-accent/50",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
              isOpen && "border-accent bg-accent/10"
            )}
          >
            <span className="truncate flex-1 text-left font-medium">
              {selectedLayer ? selectedLayer.name : 'Select a layer'}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-px h-4 bg-border" />
              <svg 
                className={cn(
                  "w-4 h-4 transition-transform duration-200 text-muted-foreground",
                  isOpen && "rotate-180"
                )}
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
        </PopoverTrigger>

        <PopoverContent 
          className="w-[var(--radix-popover-trigger-width)] p-0" 
          align="start"
          sideOffset={4}
        >
          <div className="max-h-[280px] overflow-y-auto">
            {layers.map((layer) => (
              <div
                key={layer.id}
                className={cn(
                  "flex items-center h-11 px-4 cursor-pointer",
                  "transition-all duration-150",
                  "border-l-2",
                  layer.id === selectedLayerId 
                    ? "bg-accent/20 border-accent text-accent-foreground" 
                    : "hover:bg-accent/10 border-transparent"
                )}
                onClick={() => {
                  onSelect(layer.id);
                  setIsOpen(false);
                }}
              >
                {/* Layer name */}
                <span 
                  className={cn(
                    "flex-1 text-[13px] truncate font-medium",
                    layer.id === selectedLayerId ? "text-accent" : "text-foreground"
                  )}
                  title={layer.name}
                >
                  {layer.name}
                </span>

                {/* Info button */}
                {onShowMetadata && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowMetadata(layer.id);
                    }}
                    className={cn(
                      "w-6 h-6 flex items-center justify-center rounded",
                      "ml-2 text-muted-foreground hover:text-foreground",
                      "hover:bg-accent/20 transition-colors"
                    )}
                    title="Show metadata"
                  >
                    <VscInfo className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Visibility toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisibility(layer.id);
                  }}
                  className={cn(
                    "w-6 h-6 flex items-center justify-center rounded",
                    "ml-1 text-muted-foreground hover:text-foreground",
                    "hover:bg-accent/20 transition-colors"
                  )}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                >
                  {layer.visible ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/>
                      <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/>
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
