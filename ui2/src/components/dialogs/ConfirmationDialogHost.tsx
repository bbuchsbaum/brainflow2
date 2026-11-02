import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/bf';
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
  // A new prompt's suggested value is still to be selected.
  const selectPromptPendingRef = useRef(false);
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
    selectPromptPendingRef.current = true;
  }, [activeRequest]);

  // The suggested value starts selected, so typing replaces it (QA 2026-10-31
  // N26: typing appended to "Layout 11/1/2026, 1:05:07 PM"). It is selected
  // once the input shows it, on the render after the value is set.
  useEffect(() => {
    const input = promptInputRef.current;
    if (!selectPromptPendingRef.current || !input || activeRequest?.kind !== 'prompt') return;
    if (input.value !== (activeRequest.defaultValue ?? '')) return;
    selectPromptPendingRef.current = false;
    input.select();
  }, [promptValue, activeRequest]);

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
            className={`text-sm font-semibold ${
              isDestructive ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {title}
          </h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="whitespace-pre-line text-sm text-foreground">{activeRequest.message}</p>

          {activeRequest.kind === 'prompt' && (
            <input
              ref={promptInputRef}
              // Prompts take names and ids ("qa-run4"): no macOS autocorrect or
              // capitalisation bubble (QA 2026-10-31 N5, as for Go-to in run 3).
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
            <Button type="button" variant="secondary" size="sm" onClick={handleCancel}>
              {activeRequest.cancelLabel ?? 'Cancel'}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleConfirm}
            ref={confirmButtonRef}
            variant={isDestructive ? 'danger' : 'primary'}
            size="sm"
          >
            {activeRequest.confirmLabel ?? (activeRequest.kind === 'alert' ? 'OK' : 'Confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
