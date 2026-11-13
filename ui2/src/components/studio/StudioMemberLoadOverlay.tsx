import { EmptyPane } from '@/components/ui/bf';
import { useStudioMemberLoad, useStudioMemberLoadFailure } from '@/hooks/useStudioMemberLoad';
import { useRecoverOnReconnect, useRemoteReconnect } from '@/hooks/useRemoteReconnect';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import { connectionLostTitle } from '@/utils/remoteConnectionError';

const retryMember = () => getStudioCoordinationService().retryActiveMember();

/**
 * Says what a Studio view is waiting for while its member's image is queued,
 * downloading or decoding, and why when the image could not be opened (with
 * a way to try again). A compact card on the canvas ground, in the form of
 * the orthogonal stack's "Opening …" state (EmptyStackOverlay): the view
 * stays mounted underneath and keeps the pointer, and the background
 * template it keeps drawn between members stays in sight. The card leaves
 * once the member's layer exists.
 *
 * A member that failed because its remote connection dropped is said so, and
 * the way on is to sign in again: once the mount is back (from here or from
 * any other Reconnect) the member is asked for again without another click.
 */
export function StudioMemberLoadOverlay({ sourcePath }: { sourcePath: string | null | undefined }) {
  const load = useStudioMemberLoad(sourcePath);
  const failure = useStudioMemberLoadFailure(sourcePath);
  const connectionLost = failure?.connectionLost ?? false;
  const remote = useRemoteReconnect(connectionLost ? sourcePath : null);
  useRecoverOnReconnect(sourcePath, connectionLost, retryMember);

  if (failure && connectionLost && remote.reconnecting) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[5]"
        data-testid="studio-member-reconnecting"
        role="status"
      >
        <EmptyPane
          messageGround="canvas"
          title={remote.host ? `Reconnecting to ${remote.host}…` : 'Reconnecting…'}
          hint={`${failure.name} opens when the connection is back.`}
        />
      </div>
    );
  }
  if (failure && connectionLost) {
    const retry = { label: 'Retry', onClick: retryMember, testId: 'studio-member-retry' };
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[5] [&_button]:pointer-events-auto"
        data-testid="studio-member-failed"
        data-cause="connection-lost"
        role="alert"
      >
        <EmptyPane
          messageGround="canvas"
          title={connectionLostTitle(remote.host)}
          hint={
            remote.root ? (
              <>
                <span className="block">Reconnect to keep browsing this set.</span>
                {remote.failure ? (
                  <span className="mt-1 block" data-testid="studio-member-reconnect-failure">
                    {remote.failure}
                  </span>
                ) : null}
              </>
            ) : (
              'Mount the folder again from Files, then retry.'
            )
          }
          primary={
            remote.root
              ? {
                  label: 'Reconnect',
                  onClick: () => void remote.reconnect(),
                  testId: 'studio-member-reconnect',
                }
              : retry
          }
          secondary={remote.root ? retry : null}
        />
      </div>
    );
  }
  if (failure) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[5] [&_button]:pointer-events-auto"
        data-testid="studio-member-failed"
        role="alert"
      >
        <EmptyPane
          messageGround="canvas"
          title={`Could not open ${failure.name}`}
          hint={failure.reason}
          primary={{ label: 'Retry', onClick: retryMember, testId: 'studio-member-retry' }}
        />
      </div>
    );
  }
  if (!load) return null;
  const determinate = load.progress !== null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5]"
      data-testid="studio-member-opening"
      role="status"
    >
      <EmptyPane
        messageGround="canvas"
        title={`Opening ${load.name}`}
        hint={
          <>
            <span className="block tabular-nums">{load.stage}</span>
            <span
              role="progressbar"
              aria-label="Opening progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={determinate ? Math.round(load.progress ?? 0) : undefined}
              className="mt-2 block h-0.5 w-48 max-w-full overflow-hidden bg-bf-border-subtle"
            >
              <span
                className={
                  determinate
                    ? 'block h-full bg-primary transition-[width]'
                    : 'block h-full w-full animate-pulse bg-primary'
                }
                style={determinate ? { width: `${load.progress}%` } : undefined}
              />
            </span>
          </>
        }
      />
    </div>
  );
}
