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
    <div className="relative" style={{ marginBottom: '16px' }}>
      <div className="flex justify-between text-[13px]" style={{ marginBottom: '6px' }}>
        <span style={{ color: 'var(--layer-text)' }}>Colormap</span>
        <span className="text-[11px]" style={{ color: '#94a3b8' }}>{selectedColormap.label}</span>
      </div>
      
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full rounded border overflow-hidden transition-colors"
        style={{ 
          background: selectedColormap.gradient,
          borderColor: '#666',
          borderWidth: '1px',
          height: '40px'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--layer-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = '#666';
        }}
      />

      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute bottom-full mb-2 left-0 z-50 rounded-lg shadow-xl p-3"
          style={{ 
            minWidth: '320px',
            backgroundColor: 'var(--layer-bg)',
            border: '1px solid var(--layer-divider)'
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
                className="group relative rounded transition-all p-1"
                style={{
                  backgroundColor: colormap.name === value ? 'var(--layer-selected)' : 'transparent',
                  outline: colormap.name === value ? '2px solid white' : 'none',
                  outlineOffset: '-2px'
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
                {/* Colormap preview - 48x20 */}
                <div 
                  className="w-12 h-5 rounded"
                  style={{ background: colormap.gradient }}
                />
                
                {/* Label */}
                <span className="text-[10px] block truncate mt-1" style={{ color: 'var(--layer-text)' }}>
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