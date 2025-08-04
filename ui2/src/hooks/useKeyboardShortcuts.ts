/**
 * useKeyboardShortcuts Hook
 * Global keyboard shortcuts for the application
 */

import { useEffect } from 'react';
import { useTimeNavigation } from './useTimeNavigation';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import { getEventBus } from '@/events/EventBus';

export interface KeyboardShortcut {
  key: string;
  modifiers?: {
    ctrl?: boolean;
    cmd?: boolean;
    shift?: boolean;
    alt?: boolean;
  };
  action: () => void;
  description: string;
}

// Define a function to get shortcuts (for export/documentation)
// When timeNav is not provided, we use the service for documentation purposes only
function createShortcuts(timeNav?: ReturnType<typeof useTimeNavigation>): KeyboardShortcut[] {
  return [
    // Time navigation shortcuts
    {
      key: 'ArrowLeft',
      action: () => {
        if (timeNav) {
          if (timeNav.has4DVolume()) {
            timeNav.previousTimepoint();
          }
        } else {
          // Fallback for documentation purposes
          const service = getTimeNavigationService();
          if (service.has4DVolume()) {
            service.previousTimepoint();
          }
        }
      },
      description: 'Previous timepoint'
    },
    {
      key: 'ArrowRight',
      action: () => {
        if (timeNav) {
          if (timeNav.has4DVolume()) {
            timeNav.nextTimepoint();
          }
        } else {
          // Fallback for documentation purposes
          const service = getTimeNavigationService();
          if (service.has4DVolume()) {
            service.nextTimepoint();
          }
        }
      },
      description: 'Next timepoint'
    },
    {
      key: 'ArrowLeft',
      modifiers: { shift: true },
      action: () => {
        if (timeNav) {
          if (timeNav.has4DVolume()) {
            timeNav.jumpTimepoints(-10);
          }
        } else {
          // Fallback for documentation purposes
          const service = getTimeNavigationService();
          if (service.has4DVolume()) {
            service.jumpTimepoints(-10);
          }
        }
      },
      description: 'Jump 10 timepoints backward'
    },
    {
      key: 'ArrowRight',
      modifiers: { shift: true },
      action: () => {
        if (timeNav) {
          if (timeNav.has4DVolume()) {
            timeNav.jumpTimepoints(10);
          }
        } else {
          // Fallback for documentation purposes
          const service = getTimeNavigationService();
          if (service.has4DVolume()) {
            service.jumpTimepoints(10);
          }
        }
      },
      description: 'Jump 10 timepoints forward'
    },
    {
      key: ' ', // Space bar
      action: () => {
        const eventBus = getEventBus();
        eventBus.emit('playback.toggle');
      },
      description: 'Play/pause time animation'
    },
    {
      key: 't',
      action: () => {
        const timeNav = getTimeNavigationService();
        timeNav.toggleMode();
        
        // Show feedback
        const eventBus = getEventBus();
        const mode = timeNav.getMode();
        eventBus.emit('ui.showNotification', {
          message: `Scroll wheel: ${mode === 'time' ? 'Time navigation' : 'Slice navigation'}`,
          duration: 1000
        });
      },
      description: 'Toggle time/slice navigation mode'
    },
    {
      key: 'T',
      modifiers: { shift: true },
      action: () => {
        const timeNav = getTimeNavigationService();
        timeNav.toggleMode();
        
        // Show feedback
        const eventBus = getEventBus();
        const mode = timeNav.getMode();
        eventBus.emit('ui.showNotification', {
          message: `Scroll wheel: ${mode === 'time' ? 'Time navigation' : 'Slice navigation'}`,
          duration: 1000
        });
      },
      description: 'Toggle time/slice navigation mode'
    }
  ];
}

export function useKeyboardShortcuts() {
  const timeNav = useTimeNavigation();
  
  useEffect(() => {
    // Create shortcuts inside the effect with the hook instance
    const shortcuts = createShortcuts(timeNav);
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if user is typing in an input field
      if (event.target instanceof HTMLInputElement || 
          event.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Find matching shortcut
      const shortcut = shortcuts.find(s => {
        if (s.key !== event.key) return false;
        
        const mods = s.modifiers || {};
        const ctrlMatch = !mods.ctrl || event.ctrlKey === mods.ctrl;
        const cmdMatch = !mods.cmd || event.metaKey === mods.cmd;
        const shiftMatch = !mods.shift || event.shiftKey === mods.shift;
        const altMatch = !mods.alt || event.altKey === mods.alt;
        
        return ctrlMatch && cmdMatch && shiftMatch && altMatch;
      });

      if (shortcut) {
        event.preventDefault();
        shortcut.action();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [timeNav]); // Include timeNav in dependencies
}

// Export shortcuts for documentation/help display
export function getKeyboardShortcuts(): KeyboardShortcut[] {
  return createShortcuts();
}