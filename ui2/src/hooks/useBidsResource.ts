import { useEffect, useRef, useState } from 'react';

export type BidsResource<T> =
  | { status: 'idle' | 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: string };

const IDLE = { status: 'idle', data: null, error: null } as const;
const LOADING = { status: 'loading', data: null, error: null } as const;

/** Moving J/K across runs stays free of work for the runs passed over. */
export const BIDS_RESOURCE_DELAY_MS = 90;

/**
 * Lazy data for one key. A result that arrives after the key has changed
 * (another run, another dataset) or after unmount is dropped: what is on
 * screen always belongs to the current key. `null` loads nothing.
 */
export function useBidsResource<T>(
  key: string | null,
  load: () => Promise<T>,
  delayMs = BIDS_RESOURCE_DELAY_MS,
): BidsResource<T> {
  const [state, setState] = useState<{ key: string | null; value: BidsResource<T> }>({
    key: null,
    value: IDLE,
  });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) return;
    let live = true;
    setState({ key, value: LOADING });
    const timer = setTimeout(() => {
      loadRef
        .current()
        .then((data) => {
          if (live) setState({ key, value: { status: 'ready', data, error: null } });
        })
        .catch((error: unknown) => {
          if (!live) return;
          setState({
            key,
            value: {
              status: 'error',
              data: null,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        });
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, delayMs]);

  if (key === null) return IDLE;
  // The render between a key change and its effect shows nothing stale.
  return state.key === key ? state.value : LOADING;
}
