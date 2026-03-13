import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { useConfirmationDialogStore } from '@/stores/confirmationDialogStore';
import { getFocusableElements } from '@/utils/dialogFocus';

function defaultTitle(kind: 'alert' | 'confirm' | 'prompt'): string {
  if (kind === 'alert') return 'Notice';
  if (kind === 'prompt') return 'Input Required';
  return 'Confirm Action';
}

export function ConfirmationDialogHost() {
  const activeRequest = useConfirmationDialogStore((state) => state.activeRequest);
  const markHostMounted = useConfirmationDialogStore((state) => state.markHostMounted);
  const resolveActive = useConfirmationDialogStore((state) => state.resolveActive);
  const requestId = activeRequest?.id ?? 0;
  const [promptValue, setPromptValue] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const previousBodyOverflowRef = useRef<string>('');
  const wasOpenRef = useRef(false);

  useEffect(() => {
    markHostMounted(true);
    return () => {
      markHostMounted(false);
    };
  }, [markHostMounted]);

  useEffect(() => {
    if (!activeRequest || activeRequest.kind !== 'prompt') {
      setPromptValue('');
      return;
    }

    setPromptValue(activeRequest.defaultValue ?? '');
  }, [activeRequest]);

  useEffect(() => {
    if (!activeRequest) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const focusableElements = getFocusableElements(dialogRef.current);
        if (focusableElements.length === 0) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const currentElement = document.activeElement as HTMLElement | null;
        const isInsideDialog = currentElement ? dialogRef.current?.contains(currentElement) : false;

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

      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      resolveActive(activeRequest.fallbackValue);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeRequest, resolveActive]);

  useEffect(() => {
    const isOpen = Boolean(activeRequest);

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
  }, [activeRequest]);

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
    if (!activeRequest) {
      return;
    }

    const focusTarget =
      activeRequest.kind === 'prompt'
        ? promptInputRef.current
        : confirmButtonRef.current ?? getFocusableElements(dialogRef.current)[0] ?? dialogRef.current;

    focusTarget?.focus();
  }, [activeRequest, requestId]);

  const title = useMemo(() => {
    if (!activeRequest) {
      return null;
    }
    return activeRequest.title ?? defaultTitle(activeRequest.kind);
  }, [activeRequest]);

  if (!activeRequest) {
    return null;
  }

  const handleCancel = () => {
    resolveActive(activeRequest.fallbackValue);
  };
  const isDestructive = activeRequest.tone === 'destructive';

  const handleConfirm = () => {
    if (activeRequest.kind === 'prompt') {
      resolveActive(promptValue);
      return;
    }

    if (activeRequest.kind === 'confirm') {
      resolveActive(true);
      return;
    }

    resolveActive(undefined);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
      onClick={activeRequest.kind === 'alert' ? undefined : handleCancel}
    >
      <div
        className="w-full max-w-md rounded-sm border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`confirmation-dialog-title-${requestId}`}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="border-b border-border px-5 py-3">
          <h2
            id={`confirmation-dialog-title-${requestId}`}
            className={`text-sm font-semibold uppercase tracking-[0.08em] ${
              isDestructive ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {title}
          </h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="whitespace-pre-line text-sm text-foreground/90">{activeRequest.message}</p>

          {activeRequest.kind === 'prompt' && (
            <input
              ref={promptInputRef}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleConfirm();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  handleCancel();
                }
              }}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          {activeRequest.kind !== 'alert' && (
            <Button type="button" variant="secondary" onClick={handleCancel}>
              {activeRequest.cancelLabel ?? 'Cancel'}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleConfirm}
            ref={confirmButtonRef}
            variant={isDestructive ? 'destructive' : 'default'}
          >
            {activeRequest.confirmLabel ?? (activeRequest.kind === 'alert' ? 'OK' : 'Confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
