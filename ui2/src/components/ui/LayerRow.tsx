import React from 'react';
import type { Layer } from '@/types/layers';

interface LayerRowProps {
  layer: Layer;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
}

export const LayerRow: React.FC<LayerRowProps> = ({
  layer,
  isSelected,
  onSelect,
  onToggleVisibility
}) => {
  return (
    <li
      onClick={onSelect}
      className="relative flex items-center h-[28px] px-2 cursor-pointer transition-colors"
      style={{
        backgroundColor: isSelected ? 'var(--layer-selected)' : 'transparent',
      }}
      data-selected={isSelected}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'var(--layer-hover)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
    >
      {/* Selection indicator - shows only when selected */}
      {isSelected && (
        <span className="flex items-center justify-center w-4 h-4 mr-2 flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-[var(--layer-accent)]" />
        </span>
      )}

      {/* Layer name with ellipsis */}
      <span 
        className="flex-1 text-[13px] truncate"
        style={{ color: 'var(--layer-text)' }}
        title={layer.name}
      >
        {layer.name}
      </span>

      {/* GPU status dot - 6px, positioned absolutely */}
      <div 
        className="absolute right-[28px] w-[6px] h-[6px] rounded-full"
        style={{ 
          backgroundColor: layer.loading ? '#f59e0b' : '#10b981',
          opacity: layer.loading ? 1 : 0.8
        }}
        title={layer.loading ? 'Loading...' : 'GPU Ready'}
      />

      {/* Visibility toggle - 20x20 icon */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility();
        }}
        className="w-5 h-5 flex items-center justify-center rounded transition-colors text-neutral-400 hover:text-white hover:bg-[#3A3A3A]"
        title={layer.visible ? 'Hide layer' : 'Show layer'}
      >
        {layer.visible ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style={{ opacity: 0.5 }}>
            <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/>
            <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/>
          </svg>
        )}
      </button>
    </li>
  );
};