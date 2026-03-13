import { create } from 'zustand';

export type ConfirmationDialogKind = 'alert' | 'confirm' | 'prompt';
export type ConfirmationDialogTone = 'default' | 'destructive';

export interface ConfirmationDialogRequest {
  id: number;
  kind: ConfirmationDialogKind;
  tone?: ConfirmationDialogTone;
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  fallbackValue: boolean | string | null | undefined;
  resolve: (value: boolean | string | null | undefined) => void;
}

interface ConfirmationDialogState {
  hostMounted: boolean;
  nextId: number;
  activeRequest: ConfirmationDialogRequest | null;
  queuedRequests: ConfirmationDialogRequest[];
  markHostMounted: (mounted: boolean) => void;
  enqueueRequest: (request: Omit<ConfirmationDialogRequest, 'id'>) => void;
  resolveActive: (value: boolean | string | null | undefined) => void;
  clearAll: () => void;
}

function shiftNextRequest(
  queuedRequests: ConfirmationDialogRequest[]
): {
  activeRequest: ConfirmationDialogRequest | null;
  queuedRequests: ConfirmationDialogRequest[];
} {
  if (queuedRequests.length === 0) {
    return {
      activeRequest: null,
      queuedRequests: [],
    };
  }

  const [nextRequest, ...remaining] = queuedRequests;
  return {
    activeRequest: nextRequest,
    queuedRequests: remaining,
  };
}

export const useConfirmationDialogStore = create<ConfirmationDialogState>((set, get) => ({
  hostMounted: false,
  nextId: 1,
  activeRequest: null,
  queuedRequests: [],

  markHostMounted: (mounted) => {
    set((state) => {
      if (state.hostMounted === mounted) {
        return state;
      }

      if (mounted) {
        return { hostMounted: true };
      }

      const pending = [
        ...(state.activeRequest ? [state.activeRequest] : []),
        ...state.queuedRequests,
      ];
      for (const request of pending) {
        request.resolve(request.fallbackValue);
      }

      return {
        hostMounted: false,
        activeRequest: null,
        queuedRequests: [],
      };
    });
  },

  enqueueRequest: (request) => {
    set((state) => {
      const nextRequest: ConfirmationDialogRequest = {
        ...request,
        id: state.nextId,
      };

      if (!state.activeRequest) {
        return {
          activeRequest: nextRequest,
          nextId: state.nextId + 1,
        };
      }

      return {
        queuedRequests: [...state.queuedRequests, nextRequest],
        nextId: state.nextId + 1,
      };
    });
  },

  resolveActive: (value) => {
    const activeRequest = get().activeRequest;
    if (!activeRequest) {
      return;
    }

    activeRequest.resolve(value);
    set((state) => {
      const next = shiftNextRequest(state.queuedRequests);
      return {
        activeRequest: next.activeRequest,
        queuedRequests: next.queuedRequests,
      };
    });
  },

  clearAll: () => {
    const state = get();
    const pending = [
      ...(state.activeRequest ? [state.activeRequest] : []),
      ...state.queuedRequests,
    ];
    for (const request of pending) {
      request.resolve(request.fallbackValue);
    }

    set({
      activeRequest: null,
      queuedRequests: [],
      nextId: 1,
    });
  },
}));
