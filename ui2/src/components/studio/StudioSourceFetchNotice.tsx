import { Button, EmptyPane, Notice } from '@/components/ui/bf';
import { RemoteReconnectButton } from '@/components/ui/RemoteReconnectButton';
import { formatBytes } from '@/hooks/useBidsStatusBridge';
import { useRecoverOnReconnect, useRemoteReconnect } from '@/hooks/useRemoteReconnect';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import { getStudioSourceFetchService } from '@/services/studio/StudioSourceFetchService';
import {
  useStudioSourceFetchStore,
  type StudioSourceFetchState,
} from '@/stores/studioSourceFetchStore';

type Lens = 'population' | 'compare';
type Action = 'cancel' | 'continue' | 'retry' | 'fetch';

const LENS_NAME: Record<Lens, string> = { population: 'Population', compare: 'Compare' };
const ACTION_LABEL: Record<Action, string> = {
  cancel: 'Cancel',
  continue: 'Continue',
  retry: 'Retry',
  fetch: 'Fetch images',
};

interface Shown {
  title: string;
  detail: string;
  action: Action;
  busy: boolean;
  caution: boolean;
  /** 0-100 while fetching; null otherwise. */
  percent: number | null;
}

/** What the fetch of a remote set's images reads as, for a lens. */
function describeStudioSourceFetch(
  state: Pick<
    StudioSourceFetchState,
    'phase' | 'mountLabel' | 'done' | 'total' | 'bytes' | 'message'
  >,
  lens: Lens,
): Shown | null {
  const host = state.mountLabel ?? 'the remote folder';
  const name = LENS_NAME[lens];
  const images = (count: number) => (count === 1 ? '1 image' : `${count} images`);
  switch (state.phase) {
    case 'idle':
      return null;
    case 'checking':
      return {
        title: `Checking images on ${host}…`,
        detail: `Finding which images of this set are already on this computer. ${name} opens by itself when they all are.`,
        action: 'cancel',
        busy: true,
        caution: false,
        percent: null,
      };
    case 'fetching':
      return {
        title: `Fetching images from ${host}… ${state.done} of ${state.total}`,
        detail: `${name} reads every member together, so each image is copied to this computer first. Fetched images are kept.`,
        action: 'cancel',
        busy: true,
        caution: false,
        percent: state.total ? Math.round((100 * state.done) / state.total) : null,
      };
    case 'confirm':
      return {
        title: `Fetch ${formatBytes(state.bytes)} from ${host}?`,
        detail: `${name} needs ${images(state.total)} (${formatBytes(state.bytes)}) that ${state.total === 1 ? 'is' : 'are'} not on this computer yet. Nothing has been fetched.`,
        action: 'fetch',
        busy: false,
        caution: false,
        percent: null,
      };
    case 'stopped':
      return {
        title: 'Image fetch stopped',
        detail: state.total
          ? `${state.done} of ${images(state.total)} are on this computer and are kept. Continue fetches the rest.`
          : 'The images already fetched are kept. Continue fetches the rest.',
        action: 'continue',
        busy: false,
        caution: false,
        percent: null,
      };
    case 'failed':
      return {
        title: 'The images could not be fetched',
        detail: `${state.message ?? 'The remote folder did not answer.'}${state.done > 0 ? ' The images already fetched are kept.' : ''}`,
        action: 'retry',
        busy: false,
        caution: true,
        percent: null,
      };
  }
}

function runAction(action: Action, lens: Lens) {
  const service = getStudioSourceFetchService();
  if (action === 'cancel') {
    service.stop();
    return;
  }
  service.resume();
  // Population's gate fetches again by itself; Compare's panes are computed
  // on request.
  if (lens === 'compare') getStudioCoordinationService().retryComparePanes();
}

/**
 * Where the fetch of a remote set's images is, for a lens that reads every
 * member together. `panel` stands in for the Population lens until its images
 * are local; `line` sits above Compare's panes. A running fetch is progress
 * and a stopped or unconfirmed one waits on the user: only a fetch that could
 * not finish takes the warning tone.
 */
export function StudioSourceFetchNotice({
  lens,
  variant,
}: {
  lens: Lens;
  variant: 'panel' | 'line';
}) {
  const state = useStudioSourceFetchStore();
  // A fetch that failed on a dropped connection: Reconnect comes first, and
  // the fetch runs again when the mount is back (from here or anywhere).
  const lostPath = state.phase === 'failed' ? (state.connectionLostPath ?? null) : null;
  const remote = useRemoteReconnect(lostPath);
  useRecoverOnReconnect(state.connectionLostPath, state.phase === 'failed', () =>
    runAction('retry', lens),
  );
  const shown =
    describeStudioSourceFetch(state, lens) ??
    // The panel is only drawn while images are missing: the fetch is starting.
    (variant === 'panel' ? describeStudioSourceFetch({ ...state, phase: 'checking' }, lens) : null);
  if (!shown) return null;
  const { action } = shown;
  const label = action === 'cancel' ? 'Cancel image fetch' : ACTION_LABEL[action];
  if (variant === 'line')
    return (
      <Notice
        severity={shown.caution ? 'warning' : 'neutral'}
        aria-busy={shown.busy || undefined}
        data-testid="studio-source-fetch"
        data-phase={state.phase}
        action={
          <span className="flex shrink-0 items-center gap-2">
            {lostPath ? (
              <RemoteReconnectButton
                path={lostPath}
                variant="link"
                className="min-h-6 shrink-0"
                testId="studio-source-fetch-reconnect"
              />
            ) : null}
            <Button
              variant="link"
              size="sm"
              className="min-h-6 shrink-0"
              aria-label={label}
              onClick={() => runAction(action, lens)}
            >
              {ACTION_LABEL[action]}
            </Button>
          </span>
        }
      >
        <span className="font-medium text-foreground">{shown.title}</span> {shown.detail}
      </Notice>
    );
  const own = {
    label: ACTION_LABEL[action],
    onClick: () => runAction(action, lens),
    testId: 'studio-source-fetch-action',
  };
  const reconnect =
    lostPath && remote.root
      ? {
          label: remote.reconnecting ? 'Reconnecting…' : 'Reconnect',
          onClick: () => void remote.reconnect(),
          disabled: remote.reconnecting,
          testId: 'studio-source-fetch-reconnect',
        }
      : null;
  return (
    <section
      aria-label={LENS_NAME[lens]}
      aria-busy={shown.busy || undefined}
      role="status"
      data-testid="studio-source-fetch"
      data-phase={state.phase}
      className="flex min-h-[220px] flex-1 rounded-sm border border-border bg-card p-6"
    >
      <EmptyPane
        title={shown.title}
        hint={
          <>
            <span className="mx-auto block max-w-[46ch]">{shown.detail}</span>
            {shown.busy ? (
              <span
                role="progressbar"
                aria-label="Fetching images"
                aria-valuemin={shown.percent === null ? undefined : 0}
                aria-valuemax={shown.percent === null ? undefined : 100}
                aria-valuenow={shown.percent ?? undefined}
                className="mx-auto mt-3 block h-0.5 w-48 max-w-full overflow-hidden bg-bf-border-subtle"
              >
                <span
                  className={
                    shown.percent === null
                      ? 'block h-full w-full animate-pulse bg-primary'
                      : 'block h-full bg-primary'
                  }
                  style={shown.percent === null ? undefined : { width: `${shown.percent}%` }}
                />
              </span>
            ) : null}
          </>
        }
        primary={action === 'cancel' ? null : (reconnect ?? own)}
        secondary={action === 'cancel' || reconnect ? own : null}
      />
    </section>
  );
}
