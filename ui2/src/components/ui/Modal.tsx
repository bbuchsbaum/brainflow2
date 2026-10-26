import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import React, { useEffect, useId, useRef } from 'react';
import { IconButton } from './IconButton';
import { getFocusableElements } from '@/utils/dialogFocus';
import { cn } from '@/utils/cn';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closeButtonDisabled?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  bodyClassName?: string;
  /**
   * Pinned under the scrolling body (e.g. Cancel / Save), so it stays
   * visible however tall the content is.
   */
  footer?: React.ReactNode;
  overlayClassName?: string;
  className?: string;
}

/**
 * Return focus to the element that opened the dialog. When there is none
 * (opened by a shortcut while <body> had focus) or it is gone, focus the
 * active viewport (`data-focus-return="viewport"`, the last interacted one
 * first) so keyboard users do not land on <body>.
 */
function returnFocus(previous: HTMLElement | null): void {
  if (previous?.isConnected && previous !== document.body) {
    previous.focus();
    return;
  }
  const activeId = useActiveRenderContextStore.getState().activeId;
  const viewports = Array.from(
    document.querySelectorAll<HTMLElement>('[data-focus-return="viewport"]'),
  );
  const target =
    viewports.find((el) => el.dataset.viewId === activeId) ?? viewports[0] ?? null;
  target?.focus();
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  size = 'md',
  showCloseButton = true,
  closeButtonDisabled = false,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  initialFocusRef,
  bodyClassName = '',
  footer,
  overlayClassName = '',
  className = ''
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const previousBodyOverflowRef = useRef('');
  const wasOpenRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const focusableElements = getFocusableElements(panelRef.current);
        if (focusableElements.length === 0) {
          event.preventDefault();
          panelRef.current?.focus();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const currentElement = document.activeElement as HTMLElement | null;
        const isInsideDialog = currentElement ? panelRef.current?.contains(currentElement) : false;

        if (event.shiftKey) {
          if (!isInsideDialog || currentElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
          return;
        }

        if (!isInsideDialog || currentElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
        return;
      }

      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      previousFocusedElementRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousBodyOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      wasOpenRef.current = true;
      return;
    }

    if (!isOpen && wasOpenRef.current) {
      document.body.style.overflow = previousBodyOverflowRef.current;
      wasOpenRef.current = false;
      const previousFocusedElement = previousFocusedElementRef.current;
      previousFocusedElementRef.current = null;
      returnFocus(previousFocusedElement);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (!wasOpenRef.current) {
        return;
      }

      document.body.style.overflow = previousBodyOverflowRef.current;
      returnFocus(previousFocusedElementRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusTarget =
      initialFocusRef?.current ?? getFocusableElements(panelRef.current)[0] ?? panelRef.current;
    focusTarget?.focus();
  }, [isOpen, initialFocusRef]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-full mx-4'
  };

  const handleOverlayClick = (event: React.MouseEvent) => {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose();
    }
  };

  const CloseIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );

  return (
    <div 
      className={cn(
        'fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4',
        overlayClassName
      )}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div 
        ref={panelRef}
        // Capped to the viewport (the overlay's padding is the margin): the
        // body scrolls, the header and footer stay put.
        className={`relative flex max-h-full w-full flex-col ${sizeClasses[size]} rounded-sm border border-border bg-background text-foreground shadow-xl ${className}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel ?? 'Dialog'}
        tabIndex={-1}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
            {title && (
              <h2 id={titleId} className="text-lg font-semibold text-foreground">{title}</h2>
            )}
            {showCloseButton && (
              <IconButton
                icon={<CloseIcon />}
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={closeButtonDisabled}
                aria-label="Close modal"
                className="ml-auto"
              />
            )}
          </div>
        )}

        {/* Content */}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName || 'p-4')}>
          {children}
        </div>
        {footer ? <div className="shrink-0">{footer}</div> : null}
      </div>
    </div>
  );
};
