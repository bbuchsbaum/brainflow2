import React, { useState, useRef, useEffect } from 'react';
import { colormaps } from '../ui/ColormapSelector';

interface EnhancedColormapSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export const EnhancedColormapSelector: React.FC<EnhancedColormapSelectorProps> = ({
  value,
  onChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  
  const selectedColormap = colormaps.find(cm => cm.name === value) || colormaps[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current && 
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  return (
    <div className="relative" style={{ marginBottom: '12px' }}>
      {/* Label - Instrument Control style */}
      <div className="flex justify-between items-baseline" style={{ marginBottom: '6px' }}>
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--app-text-muted)' }}>
          Colormap
        </span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--app-text-secondary)' }}>
          {selectedColormap.label}
        </span>
      </div>

      {/* Gradient bar - no border-radius (Instrument Control) */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full overflow-hidden transition-colors border"
        style={{
          background: selectedColormap.gradient,
          borderColor: 'var(--app-border)',
          borderWidth: '1px',
          borderRadius: '1px',
          height: '24px'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--layer-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--app-border)';
        }}
      />

      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute bottom-full mb-2 left-0 z-50 shadow-xl p-3"
          style={{
            minWidth: '320px',
            backgroundColor: 'var(--layer-bg)',
            border: '1px solid var(--layer-divider)',
            borderRadius: '2px'
          }}
        >
          <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto scrollbar-thin">
            {colormaps.map((colormap) => (
              <button
                key={colormap.name}
                onClick={() => {
                  onChange(colormap.name);
                  setIsOpen(false);
                }}
                className="group relative transition-all p-1"
                style={{
                  backgroundColor: colormap.name === value ? 'var(--layer-selected)' : 'transparent',
                  outline: colormap.name === value ? '2px solid var(--layer-accent)' : 'none',
                  outlineOffset: '-2px',
                  borderRadius: '1px'
                }}
                onMouseEnter={(e) => {
                  if (colormap.name !== value) {
                    e.currentTarget.style.backgroundColor = 'var(--layer-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (colormap.name !== value) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                {/* Colormap preview - no border-radius */}
                <div
                  className="w-12 h-4"
                  style={{ background: colormap.gradient, borderRadius: '1px' }}
                />

                {/* Label */}
                <span className="text-[9px] uppercase tracking-wider block truncate mt-1" style={{ color: 'var(--layer-text)' }}>
                  {colormap.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};