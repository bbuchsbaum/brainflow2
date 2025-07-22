import React, { useState, useEffect } from 'react';

interface Colormap {
  name: string;
  label: string;
  gradient: string;
}

interface ColormapSelectorProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

// Common neuroimaging colormaps - must match backend colormap names
export const colormaps: Colormap[] = [
  { name: 'gray', label: 'Grayscale', gradient: 'linear-gradient(to right, #000000, #ffffff)' },
  { name: 'viridis', label: 'Viridis', gradient: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)' },
  { name: 'hot', label: 'Hot', gradient: 'linear-gradient(to right, #000000, #ff0000, #ffff00, #ffffff)' },
  { name: 'cool', label: 'Cool', gradient: 'linear-gradient(to right, #00ffff, #ff00ff)' },
  { name: 'plasma', label: 'Plasma', gradient: 'linear-gradient(to right, #0d0887, #7e03a8, #cc4778, #f89441, #f0f921)' },
  { name: 'inferno', label: 'Inferno', gradient: 'linear-gradient(to right, #000004, #721f81, #b73779, #fc9f07, #fcffa4)' },
  { name: 'magma', label: 'Magma', gradient: 'linear-gradient(to right, #000004, #711c81, #b63679, #fb8861, #fcfdbf)' },
  { name: 'turbo', label: 'Turbo', gradient: 'linear-gradient(to right, #30123b, #4454c4, #1fc9de, #72f91e, #fde725, #c42503)' },
  { name: 'pet', label: 'PET Hot Metal', gradient: 'linear-gradient(to right, #000000, #5a0000, #ff0000, #ffff00, #ffffff)' },
  { name: 'fmri', label: 'fMRI Red-Blue', gradient: 'linear-gradient(to right, #0000ff, #ffffff, #ff0000)' },
  { name: 'jet', label: 'Jet', gradient: 'linear-gradient(to right, #000080, #0000ff, #00ffff, #ffff00, #ff0000, #800000)' },
  { name: 'parula', label: 'Parula', gradient: 'linear-gradient(to right, #352a87, #0363e1, #1485d4, #06a7c6, #38b99e, #92bf73, #d9ba56, #fcce2e, #f9fb0e)' },
  { name: 'hsv', label: 'HSV', gradient: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' },
  { name: 'phase', label: 'Phase', gradient: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)' },
];

export const ColormapSelector: React.FC<ColormapSelectorProps> = ({
  value,
  disabled = false,
  onChange
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const selectedColormap = colormaps.find(cm => cm.name === value) || colormaps[0];

  function selectColormap(colormapName: string) {
    onChange(colormapName);
    setShowDropdown(false);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowDropdown(false);
      }
    }

    if (showDropdown) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [showDropdown]);

  return (
    <div className="colormap-selector relative">
      <label className="block text-xs font-medium text-gray-700 mb-1">Colormap</label>
      
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={disabled}
        onClick={() => setShowDropdown(!showDropdown)}
      >
        {/* Preview */}
        <div 
          className="flex-1 h-4 rounded border"
          style={{ background: selectedColormap.gradient }}
        />
        
        {/* Label */}
        <span className="text-gray-700">{selectedColormap.label}</span>
        
        {/* Dropdown arrow */}
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </button>

      {showDropdown && !disabled && (
        <>
          {/* Dropdown */}
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {colormaps.map((colormap) => (
              <button
                key={colormap.name}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50 ${
                  colormap.name === value ? 'bg-blue-50' : ''
                }`}
                onClick={() => selectColormap(colormap.name)}
              >
                {/* Preview */}
                <div 
                  className="w-16 h-4 rounded border"
                  style={{ background: colormap.gradient }}
                />
                
                {/* Label */}
                <span className="flex-1 text-gray-700">{colormap.label}</span>
                
                {/* Selected indicator */}
                {colormap.name === value && (
                  <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path>
                  </svg>
                )}
              </button>
            ))}
          </div>
          
          {/* Click outside to close */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowDropdown(false)}
          />
        </>
      )}
    </div>
  );
};