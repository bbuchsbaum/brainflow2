/**
 * FieldRow Component
 * 
 * Provides consistent two-column layout for form fields in dialogs.
 * Aligns labels and controls for better visual hierarchy.
 */

import React, { ReactNode } from 'react';
import { Label } from '@/components/ui/shadcn/label';

interface FieldRowProps {
  label: string;
  children: ReactNode;
  htmlFor?: string;
}

export function FieldRow({ label, children, htmlFor }: FieldRowProps) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-4 py-3">
      <Label htmlFor={htmlFor} className="text-sm text-gray-300">
        {label}
      </Label>
      <div className="flex items-center">
        {children}
      </div>
    </div>
  );
}