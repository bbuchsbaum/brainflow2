import React from 'react';
import { ColormapPicker } from '@/components/ui/ColormapPicker';

interface EnhancedColormapSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const EnhancedColormapSelector: React.FC<EnhancedColormapSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => (
  <ColormapPicker
    value={value}
    disabled={disabled}
    onChange={onChange}
    variant="enhanced"
  />
);
