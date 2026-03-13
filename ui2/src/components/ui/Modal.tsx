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
  overlayClassName?: string;
  className?: string;
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
      if (previousFocusedElement?.isConnected) {
        previousFocusedElement.focus();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (!wasOpenRef.current) {
        return;
      }

      document.body.style.overflow = previousBodyOverflowRef.current;
      const previousFocusedElement = previousFocusedElementRef.current;
      if (previousFocusedElement?.isConnected) {
        previousFocusedElement.focus();
      }
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
        className={`relative w-full ${sizeClasses[size]} rounded-lg border border-border bg-background text-foreground shadow-xl ${className}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel ?? 'Dialog'}
        tabIndex={-1}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between border-b border-border p-4">
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
        <div className={bodyClassName || 'p-4'}>
          {children}
        </div>
      </div>
    </div>
  );
};
