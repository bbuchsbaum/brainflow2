import React, { useState, useRef, useEffect } from 'react';
import type { Layer } from '@/types/layers';

interface LayerDropdownProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
}

export const LayerDropdown: React.FC<LayerDropdownProps> = ({
  layers,
  selectedLayerId,
  onSelect,
  onToggleVisibility
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  const selectedLayer = layers.find(l => l.id === selectedLayerId);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node) &&
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

  if (layers.length === 0) {
    return (
      <div className="text-[13px] text-neutral-500 text-center py-4">
        No layers loaded
      </div>
    );
  }

  return (
    <div className="relative" style={{ marginBottom: '16px' }}>
      {/* Label */}
      <label className="block text-[13px] font-medium" style={{ color: 'var(--layer-text)', marginBottom: '8px' }}>
        Active Layer
      </label>
      
      {/* Dropdown button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-10 px-3 flex items-center justify-between rounded-md border transition-all text-[13px] hover:border-gray-400"
        style={{ 
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderColor: isOpen ? 'var(--layer-accent)' : 'rgba(255, 255, 255, 0.1)',
          color: 'var(--layer-text)',
          boxShadow: isOpen ? '0 0 0 1px var(--layer-accent)' : 'none'
        }}
      >
        <span className="truncate flex-1 text-left">
          {selectedLayer ? selectedLayer.name : 'Select a layer'}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Dropdown indicator with better styling */}
          <div className="w-px h-4 bg-gray-600" />
          <svg 
            className={`w-4 h-4 transition-transform text-gray-400 ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute top-full mt-1 w-full z-50 rounded-lg shadow-xl overflow-hidden"
          style={{ 
            backgroundColor: 'var(--layer-bg)',
            border: '1px solid var(--layer-divider)',
            maxHeight: '240px',
            overflowY: 'auto'
          }}
        >
          {layers.map((layer) => (
            <div
              key={layer.id}
              className="flex items-center h-10 px-3 cursor-pointer transition-colors"
              style={{
                backgroundColor: layer.id === selectedLayerId ? 'var(--layer-selected)' : 'transparent',
              }}
              onClick={() => {
                onSelect(layer.id);
                setIsOpen(false);
              }}
              onMouseEnter={(e) => {
                if (layer.id !== selectedLayerId) {
                  e.currentTarget.style.backgroundColor = 'var(--layer-hover)';
                }
              }}
              onMouseLeave={(e) => {
                if (layer.id !== selectedLayerId) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {/* Layer name */}
              <span 
                className="flex-1 text-[13px] truncate"
                style={{ color: 'var(--layer-text)' }}
                title={layer.name}
              >
                {layer.name}
              </span>

              {/* Visibility toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
                className="w-5 h-5 flex items-center justify-center rounded transition-colors text-neutral-400 hover:text-white hover:bg-[#3A3A3A] ml-2"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style={{ opacity: 0.5 }}>
                    <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/>
                    <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/>
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};