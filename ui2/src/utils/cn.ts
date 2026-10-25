import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the project's custom font-size keys (tailwind.config.js `fontSize`).
// Without this, `text-bf-sm` is classified as a text *colour* and silently removes a
// real colour class such as `text-primary-foreground` when both are merged.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['bf-2xs', 'bf-xs', 'bf-sm', 'bf-md', 'bf-lg'] },
        { text: ['role-title', 'role-section', 'role-label', 'role-body', 'role-value'] },
      ],
    },
  },
});

/**
 * Utility function to merge Tailwind CSS classes with proper precedence
 * This is the standard pattern used by shadcn/ui components
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
