/**
 * NotificationToast - Simple notification display
 * Shows temporary toast messages for user feedback
 */

import React, { useEffect, useState } from 'react';
import { useEvent } from '@/events/EventBus';

interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

export function NotificationToast() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  
  // Listen for notification events
  useEvent('ui.notification', ({ type, message }) => {
    const notification: Notification = {
      id: Date.now().toString(),
      type,
      message,
      timestamp: Date.now()
    };
    
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  });
  
  if (notifications.length === 0) return null;
  
  // Bauhaus-themed notification styles
  const getNotificationStyle = (type: Notification['type']) => {
    const base = {
      borderRadius: '1px',
      border: '1px solid',
    };
    switch (type) {
      case 'info':
        return {
          ...base,
          backgroundColor: 'hsl(var(--muted))',
          borderColor: 'hsl(var(--border))',
          color: 'hsl(var(--foreground))',
        };
      case 'warning':
        return {
          ...base,
          backgroundColor: 'hsl(var(--muted))',
          borderColor: 'hsl(45 100% 40%)',
          color: 'hsl(var(--foreground))',
        };
      case 'error':
        return {
          ...base,
          backgroundColor: 'hsl(var(--destructive) / 0.1)',
          borderColor: 'hsl(var(--destructive))',
          color: 'hsl(var(--foreground))',
        };
    }
  };

  const getIndicatorColor = (type: Notification['type']) => {
    switch (type) {
      case 'info': return 'hsl(var(--primary))';
      case 'warning': return 'hsl(45 100% 50%)';
      case 'error': return 'hsl(var(--destructive))';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className="px-4 py-3 shadow-lg animate-slide-in-right"
          style={getNotificationStyle(notification.type)}
        >
          <div className="flex items-center gap-3">
            {/* Geometric status indicator - replaces circular icons */}
            <div
              className="w-2 h-2 shrink-0"
              style={{
                backgroundColor: getIndicatorColor(notification.type),
                borderRadius: '1px'
              }}
            />
            <span className="text-[11px] font-mono uppercase tracking-wider">{notification.message}</span>
          </div>
        </div>
      ))}
    </div>
  );
}