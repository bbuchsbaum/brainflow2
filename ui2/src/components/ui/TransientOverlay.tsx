/**
 * TransientOverlay Component
 * Shows temporary information that fades out after a specified duration
 */

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface TransientOverlayProps {
  message: string;
  duration?: number; // Duration in milliseconds before fading out
  position?: 'center' | 'top-center' | 'bottom-center' | 'top-left' | 'top-right';
  className?: string;
  onHide?: () => void;
}

export function TransientOverlay({
  message,
  duration = 500,
  position = 'center',
  className = '',
  onHide
}: TransientOverlayProps) {
  const [visible, setVisible] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing timeouts
    if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);

    // Reset to visible
    setVisible(true);
    setOpacity(1);

    // Start fade out after duration
    fadeTimeoutRef.current = setTimeout(() => {
      setOpacity(0);
      
      // Hide completely after fade animation
      hideTimeoutRef.current = setTimeout(() => {
        setVisible(false);
        onHide?.();
      }, 300); // Match transition duration
    }, duration);

    return () => {
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [message, duration, onHide]);

  if (!visible) return null;

  const positionClasses = {
    'center': 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
    'top-center': 'top-8 left-1/2 -translate-x-1/2',
    'bottom-center': 'bottom-8 left-1/2 -translate-x-1/2',
    'top-left': 'top-8 left-8',
    'top-right': 'top-8 right-8'
  };

  const overlay = (
    <div
      className={`fixed z-50 pointer-events-none ${positionClasses[position]} ${className}`}
      style={{
        opacity,
        transition: 'opacity 300ms ease-out'
      }}
    >
      <div className="bg-gray-900 bg-opacity-90 text-white px-4 py-2 rounded-lg shadow-lg">
        <div className="text-sm font-medium">{message}</div>
      </div>
    </div>
  );

  // Render to body using portal
  return createPortal(overlay, document.body);
}

// Hook for managing transient overlay state
interface UseTransientOverlayOptions {
  duration?: number;
  position?: TransientOverlayProps['position'];
}

export function useTransientOverlay(options: UseTransientOverlayOptions = {}) {
  const [message, setMessage] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const show = (msg: string) => {
    setMessage(msg);
    setKey(prev => prev + 1); // Force re-mount for new message
  };

  const hide = () => {
    setMessage(null);
  };

  const overlay = message ? (
    <TransientOverlay
      key={key}
      message={message}
      duration={options.duration}
      position={options.position}
      onHide={hide}
    />
  ) : null;

  return { show, hide, overlay };
}