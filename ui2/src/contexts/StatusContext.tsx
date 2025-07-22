/**
 * StatusContext - Global state management for status bar
 * Provides centralized control over status bar items
 */

import React, { createContext, useReducer, useContext, type ReactNode } from 'react';
import type { StatusSlot, StatusBatchUpdate } from '@/types/statusBar';

// State type - maps slot IDs to their data (excluding the ID itself)
type State = Record<string, Omit<StatusSlot, 'id'>>;

// Action types for updating status
type Action =
  | { type: 'SET'; id: string; value: string | ReactNode }
  | { type: 'BATCH'; entries: StatusBatchUpdate }
  | { type: 'UPDATE_LABEL'; id: string; label: string }
  | { type: 'UPDATE_WIDTH'; id: string; width: string | number };

// Reducer to handle state updates
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET':
      // Update just the value, creating slot if it doesn't exist
      return {
        ...state,
        [action.id]: {
          label: '', // Default label if slot doesn't exist
          ...state[action.id],
          value: action.value
        }
      };
    
    case 'BATCH': {
      // Update multiple values at once
      const next = { ...state };
      action.entries.forEach(([id, value]) => {
        // Create slot with defaults if it doesn't exist
        next[id] = { 
          label: '', // Default label
          ...next[id], 
          value 
        };
      });
      return next;
    }
    
    case 'UPDATE_LABEL':
      // Only update if slot exists (label without value doesn't make sense)
      if (!state[action.id]) return state;
      return {
        ...state,
        [action.id]: {
          ...state[action.id],
          label: action.label
        }
      };
    
    case 'UPDATE_WIDTH':
      // Only update if slot exists
      if (!state[action.id]) return state;
      return {
        ...state,
        [action.id]: {
          ...state[action.id],
          width: action.width
        }
      };
    
    default:
      return state;
  }
}

// Context type
type StatusContextType = [State, React.Dispatch<Action>];

// Create context with undefined default (will be provided by StatusProvider)
const StatusContext = createContext<StatusContextType | undefined>(undefined);

// Provider props
interface StatusProviderProps {
  initial: StatusSlot[];
  children: ReactNode;
}

/**
 * StatusProvider - Wraps the app to provide status bar state
 */
export const StatusProvider: React.FC<StatusProviderProps> = ({ initial, children }) => {
  // Convert initial slots array to state object
  const initialState: State = Object.fromEntries(
    initial.map(slot => [slot.id, {
      label: slot.label,
      value: slot.value,
      width: slot.width,
      align: slot.align
    }])
  );
  
  const contextValue = useReducer(reducer, initialState);
  
  return (
    <StatusContext.Provider value={contextValue}>
      {children}
    </StatusContext.Provider>
  );
};

/**
 * useStatus - Hook to read current status state
 * Returns the complete state object with all slots
 */
export const useStatus = (): State => {
  const context = useContext(StatusContext);
  if (!context) {
    throw new Error('useStatus must be used within a StatusProvider');
  }
  return context[0];
};

/**
 * useStatusSlot - Hook to read a specific slot's data
 * Returns undefined if slot doesn't exist
 */
export const useStatusSlot = (id: string): Omit<StatusSlot, 'id'> | undefined => {
  const status = useStatus();
  return status[id];
};

/**
 * useSetStatus - Hook to get the dispatch function for updates
 * Returns the dispatch function to send actions
 */
export const useSetStatus = (): React.Dispatch<Action> => {
  const context = useContext(StatusContext);
  if (!context) {
    throw new Error('useSetStatus must be used within a StatusProvider');
  }
  return context[1];
};

/**
 * Helper hook for common update patterns
 */
export const useStatusUpdater = () => {
  const dispatch = useSetStatus();
  
  return {
    // Update a single value
    setValue: (id: string, value: string | ReactNode) => {
      dispatch({ type: 'SET', id, value });
    },
    
    // Update multiple values at once
    setBatch: (entries: StatusBatchUpdate) => {
      dispatch({ type: 'BATCH', entries });
    },
    
    // Update label (less common)
    setLabel: (id: string, label: string) => {
      dispatch({ type: 'UPDATE_LABEL', id, label });
    },
    
    // Update width (rare, usually only during development)
    setWidth: (id: string, width: string | number) => {
      dispatch({ type: 'UPDATE_WIDTH', id, width });
    }
  };
};