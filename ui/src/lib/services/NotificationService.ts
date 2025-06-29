/**
 * NotificationService - Service layer for user notifications
 * Handles toast messages, progress tracking, and user feedback
 */

import type { EventBus } from '$lib/events/EventBus';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number; // milliseconds, 0 = persistent
  action?: {
    label: string;
    handler: () => void;
  };
  progress?: {
    value: number; // 0-100
    indeterminate?: boolean;
  };
  timestamp: number;
  dismissed: boolean;
}

export interface NotificationOptions {
  type?: NotificationType;
  duration?: number;
  action?: {
    label: string;
    handler: () => void;
  };
  progress?: {
    value: number;
    indeterminate?: boolean;
  };
}

export interface ProgressNotification {
  id: string;
  update: (progress: number, message?: string) => void;
  complete: (message?: string) => void;
  error: (message: string) => void;
}

export interface NotificationServiceConfig {
  eventBus: EventBus;
  maxNotifications?: number;
  defaultDuration?: number;
}

export class NotificationService {
  private config: NotificationServiceConfig;
  private notifications = new Map<string, Notification>();
  private notificationQueue: Notification[] = [];
  private idCounter = 0;
  private maxNotifications: number;
  private defaultDuration: number;

  constructor(config: NotificationServiceConfig) {
    this.config = config;
    this.maxNotifications = config.maxNotifications || 5;
    this.defaultDuration = config.defaultDuration || 5000;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Auto-show notifications for common events
    this.config.eventBus.on('volume.loaded', ({ metadata, loadTime }) => {
      this.success(`Volume loaded: ${metadata.name}`, {
        message: `Loaded in ${loadTime.toFixed(0)}ms`,
        duration: 3000
      });
    });

    this.config.eventBus.on('volume.load.failed', ({ path, error }) => {
      this.error(`Failed to load volume`, {
        message: error.message || 'Unknown error',
        action: {
          label: 'Retry',
          handler: () => this.config.eventBus.emit('volume.retry', { path })
        }
      });
    });

    this.config.eventBus.on('layer.gpu.request.success', ({ layerId }) => {
      this.success('GPU resources allocated', {
        duration: 2000
      });
    });

    this.config.eventBus.on('error.boundary.caught', ({ error, componentStack }) => {
      this.error('Application error', {
        message: error.message,
        duration: 0, // Persistent
        action: {
          label: 'Reload',
          handler: () => window.location.reload()
        }
      });
    });
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `notification-${++this.idCounter}`;
  }

  /**
   * Create notification object
   */
  private createNotification(
    title: string,
    options: NotificationOptions = {}
  ): Notification {
    const notification: Notification = {
      id: this.generateId(),
      type: options.type || 'info',
      title,
      message: options.message,
      duration: options.duration ?? this.defaultDuration,
      action: options.action,
      progress: options.progress,
      timestamp: Date.now(),
      dismissed: false
    };

    return notification;
  }

  /**
   * Add notification to queue
   */
  private addNotification(notification: Notification) {
    this.notifications.set(notification.id, notification);
    this.notificationQueue.push(notification);

    // Enforce max notifications
    while (this.notificationQueue.length > this.maxNotifications) {
      const oldest = this.notificationQueue.shift();
      if (oldest && !oldest.dismissed) {
        this.dismiss(oldest.id);
      }
    }

    // Emit event for UI
    this.config.eventBus.emit('notification.show', notification);

    // Auto-dismiss if duration is set
    if (notification.duration && notification.duration > 0) {
      setTimeout(() => {
        if (!notification.dismissed) {
          this.dismiss(notification.id);
        }
      }, notification.duration);
    }
  }

  /**
   ===============================================
   Public API
   ===============================================
   */

  /**
   * Show info notification
   */
  info(title: string, options?: NotificationOptions & { message?: string }) {
    const notification = this.createNotification(title, {
      ...options,
      type: 'info'
    });
    this.addNotification(notification);
    return notification.id;
  }

  /**
   * Show success notification
   */
  success(title: string, options?: NotificationOptions & { message?: string }) {
    const notification = this.createNotification(title, {
      ...options,
      type: 'success'
    });
    this.addNotification(notification);
    return notification.id;
  }

  /**
   * Show warning notification
   */
  warning(title: string, options?: NotificationOptions & { message?: string }) {
    const notification = this.createNotification(title, {
      ...options,
      type: 'warning'
    });
    this.addNotification(notification);
    return notification.id;
  }

  /**
   * Show error notification
   */
  error(title: string, options?: NotificationOptions & { message?: string }) {
    const notification = this.createNotification(title, {
      ...options,
      type: 'error',
      duration: options?.duration ?? 0 // Errors are persistent by default
    });
    this.addNotification(notification);
    return notification.id;
  }

  /**
   * Show progress notification
   */
  progress(title: string, options?: { message?: string; indeterminate?: boolean }): ProgressNotification {
    const notification = this.createNotification(title, {
      type: 'info',
      message: options?.message,
      duration: 0, // Progress notifications are persistent
      progress: {
        value: 0,
        indeterminate: options?.indeterminate || false
      }
    });

    this.addNotification(notification);

    // Return control object
    return {
      id: notification.id,
      update: (value: number, message?: string) => {
        this.updateProgress(notification.id, value, message);
      },
      complete: (message?: string) => {
        this.completeProgress(notification.id, message);
      },
      error: (message: string) => {
        this.errorProgress(notification.id, message);
      }
    };
  }

  /**
   * Update progress notification
   */
  private updateProgress(id: string, value: number, message?: string) {
    const notification = this.notifications.get(id);
    if (!notification || notification.dismissed) return;

    if (notification.progress) {
      notification.progress.value = Math.min(100, Math.max(0, value));
    }
    
    if (message !== undefined) {
      notification.message = message;
    }

    this.config.eventBus.emit('notification.update', notification);
  }

  /**
   * Complete progress notification
   */
  private completeProgress(id: string, message?: string) {
    const notification = this.notifications.get(id);
    if (!notification || notification.dismissed) return;

    notification.type = 'success';
    notification.message = message || 'Complete';
    notification.duration = 3000;
    delete notification.progress;

    this.config.eventBus.emit('notification.update', notification);

    // Auto-dismiss after duration
    setTimeout(() => {
      if (!notification.dismissed) {
        this.dismiss(id);
      }
    }, notification.duration);
  }

  /**
   * Error progress notification
   */
  private errorProgress(id: string, message: string) {
    const notification = this.notifications.get(id);
    if (!notification || notification.dismissed) return;

    notification.type = 'error';
    notification.message = message;
    notification.duration = 0; // Make persistent
    delete notification.progress;

    this.config.eventBus.emit('notification.update', notification);
  }

  /**
   * Dismiss notification
   */
  dismiss(id: string) {
    const notification = this.notifications.get(id);
    if (!notification || notification.dismissed) return;

    notification.dismissed = true;
    this.config.eventBus.emit('notification.dismiss', { id });

    // Remove from queue
    const index = this.notificationQueue.findIndex(n => n.id === id);
    if (index !== -1) {
      this.notificationQueue.splice(index, 1);
    }

    // Clean up after delay
    setTimeout(() => {
      this.notifications.delete(id);
    }, 500);
  }

  /**
   * Dismiss all notifications
   */
  dismissAll() {
    for (const notification of this.notifications.values()) {
      if (!notification.dismissed) {
        this.dismiss(notification.id);
      }
    }
  }

  /**
   * Get active notifications
   */
  getActiveNotifications(): Notification[] {
    return this.notificationQueue.filter(n => !n.dismissed);
  }

  /**
   * Check if notification exists
   */
  hasNotification(id: string): boolean {
    const notification = this.notifications.get(id);
    return notification !== undefined && !notification.dismissed;
  }

  /**
   * Convenience methods for common operations
   */

  /**
   * Show file operation progress
   */
  fileOperation(operation: string, filename: string): ProgressNotification {
    return this.progress(`${operation} ${filename}`, {
      indeterminate: true
    });
  }

  /**
   * Show confirmation notification
   */
  confirm(
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void
  ): string {
    return this.warning(title, {
      message,
      duration: 0,
      action: {
        label: 'Confirm',
        handler: () => {
          this.dismiss(id);
          onConfirm();
        }
      }
    });
    
    // Note: In a real implementation, you'd want a proper confirmation dialog
    // This is a simplified version using notifications
  }

  /**
   * Show input prompt notification
   */
  prompt(
    title: string,
    message: string,
    defaultValue: string,
    onSubmit: (value: string) => void
  ): string {
    // This would require a custom notification component with input
    // For now, just show info with action
    return this.info(title, {
      message,
      duration: 0,
      action: {
        label: 'Open Dialog',
        handler: () => {
          // In real implementation, open a proper dialog
          const value = window.prompt(message, defaultValue);
          if (value !== null) {
            onSubmit(value);
          }
        }
      }
    });
  }

  /**
   * Dispose of the service
   */
  dispose() {
    this.dismissAll();
    this.notifications.clear();
    this.notificationQueue = [];
  }
}

// Factory function for dependency injection
export function createNotificationService(config: NotificationServiceConfig): NotificationService {
  return new NotificationService(config);
}