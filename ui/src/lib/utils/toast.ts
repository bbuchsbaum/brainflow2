/**
 * Simple toast notification system
 */

export interface ToastOptions {
  duration?: number;
  position?: 'top' | 'bottom' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';

class ToastManager {
  private container: HTMLElement | null = null;
  private toasts: Set<HTMLElement> = new Set();

  private ensureContainer() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      this.container.setAttribute('aria-live', 'polite');
      this.container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(this.container);

      // Add styles if not already present
      if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
          .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .toast {
            min-width: 250px;
            max-width: 400px;
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
            line-height: 1.4;
            pointer-events: auto;
            animation: slideIn 0.3s ease-out;
            transition: opacity 0.3s, transform 0.3s;
          }

          .toast.fade-out {
            opacity: 0;
            transform: translateX(100%);
          }

          .toast-success {
            background-color: #10b981;
            color: white;
          }

          .toast-error {
            background-color: #ef4444;
            color: white;
          }

          .toast-warning {
            background-color: #f59e0b;
            color: white;
          }

          .toast-info {
            background-color: #3b82f6;
            color: white;
          }

          .toast-icon {
            font-size: 18px;
            flex-shrink: 0;
          }

          .toast-message {
            flex: 1;
          }

          .toast-close {
            background: none;
            border: none;
            color: inherit;
            cursor: pointer;
            font-size: 18px;
            padding: 0;
            margin-left: 10px;
            opacity: 0.7;
            transition: opacity 0.2s;
          }

          .toast-close:hover {
            opacity: 1;
          }

          @keyframes slideIn {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }

          @media (max-width: 640px) {
            .toast-container {
              left: 10px;
              right: 10px;
              top: 10px;
            }

            .toast {
              max-width: none;
            }
          }
        `;
        document.head.appendChild(style);
      }
    }
    return this.container;
  }

  show(message: string, type: ToastType = 'info', options: ToastOptions = {}) {
    const { duration = 4000 } = options;
    const container = this.ensureContainer();

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Add icon
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = this.getIcon(type);
    
    // Add message
    const messageEl = document.createElement('span');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.remove(toast);
    
    // Assemble toast
    toast.appendChild(icon);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);
    
    // Add to container
    container.appendChild(toast);
    this.toasts.add(toast);

    // Auto remove after duration
    if (duration > 0) {
      setTimeout(() => this.remove(toast), duration);
    }

    return toast;
  }

  remove(toast: HTMLElement) {
    if (!this.toasts.has(toast)) return;
    
    toast.classList.add('fade-out');
    
    setTimeout(() => {
      toast.remove();
      this.toasts.delete(toast);
      
      // Remove container if no more toasts
      if (this.toasts.size === 0 && this.container) {
        this.container.remove();
        this.container = null;
      }
    }, 300);
  }

  private getIcon(type: ToastType): string {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'warning': return '⚠';
      case 'info': return 'ℹ';
    }
  }

  success(message: string, options?: ToastOptions) {
    return this.show(message, 'success', options);
  }

  error(message: string, options?: ToastOptions) {
    return this.show(message, 'error', options);
  }

  warning(message: string, options?: ToastOptions) {
    return this.show(message, 'warning', options);
  }

  info(message: string, options?: ToastOptions) {
    return this.show(message, 'info', options);
  }

  clear() {
    this.toasts.forEach(toast => this.remove(toast));
  }
}

// Export singleton instance
export const toast = new ToastManager();