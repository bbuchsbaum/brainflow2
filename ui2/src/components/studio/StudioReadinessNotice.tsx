import { Button, EmptyPane, Notice } from '@/components/ui/bf';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import type { StudioReadiness, StudioReadinessLens } from '@/services/studio/studioReadiness';
import { useStudioReadiness } from '@/hooks/useStudioReadiness';
import { useRecoverOnReconnect, useRemoteReconnect } from '@/hooks/useRemoteReconnect';

const ACTION_LABEL = {
  cancel: 'Cancel',
  check: 'Check image grids',
  retry: 'Retry',
  continue: 'Continue checking',
} as const;

function runAction(action: NonNullable<StudioReadiness['action']>) {
  const service = getSetIngestionService();
  if (action === 'cancel') service.cancelGridCheck();
  else void service.checkActiveSetGrids();
}

/**
 * The one state a lens shows while the set cannot be read together.
 *
 * `panel` stands in for the whole lens (Population): what is happening or
 * needed, and the action, in place of empty image wells. `line` sits above a
 * lens that still shows something (Compare's member pane). Neither is drawn
 * as an error: a running check is progress, and headers nobody has read are
 * not a failure. Only a check that could not read them, or images that
 * cannot be read together, take the warning tone.
 */
export function StudioReadinessNotice({
  lens,
  variant,
}: {
  lens: StudioReadinessLens;
  variant: 'panel' | 'line';
}) {
  const readiness = useStudioReadiness(lens);
  // A check that failed on a dropped connection: Reconnect comes first, and
  // the check runs again when the mount is back (from here or anywhere).
  const remote = useRemoteReconnect(readiness.reconnectPath);
  useRecoverOnReconnect(readiness.reconnectPath, readiness.phase === 'check-failed', () =>
    runAction('retry'),
  );
  if (readiness.phase === 'ready') return null;
  const reconnect = remote.root
    ? {
        label: remote.reconnecting ? 'Reconnecting…' : 'Reconnect',
        onClick: () => void remote.reconnect(),
        disabled: remote.reconnecting,
        testId: 'studio-readiness-reconnect',
      }
    : null;
  const { action } = readiness;
  const checking = readiness.phase === 'checking';
  const caution = readiness.phase === 'check-failed' || readiness.phase === 'unavailable';
  const label = action
    ? action === 'cancel'
      ? 'Cancel image grid check'
      : ACTION_LABEL[action]
    : undefined;
  if (variant === 'line')
    return (
      <Notice
        severity={caution ? 'warning' : 'neutral'}
        aria-busy={checking || undefined}
        data-testid="studio-readiness"
        data-phase={readiness.phase}
        action={
          action ? (
            <span className="flex shrink-0 items-center gap-2">
              {reconnect ? (
                <Button
                  variant="link"
                  size="sm"
                  className="min-h-6 shrink-0"
                  disabled={reconnect.disabled}
                  data-testid={reconnect.testId}
                  onClick={reconnect.onClick}
                >
                  {reconnect.label}
                </Button>
              ) : null}
              <Button
                variant="link"
                size="sm"
                className="min-h-6 shrink-0"
                aria-label={label}
                onClick={() => runAction(action)}
              >
                {ACTION_LABEL[action]}
              </Button>
            </span>
          ) : undefined
        }
      >
        <span className="font-medium text-foreground">{readiness.title}</span>
        {readiness.detail ? ` ${readiness.detail}` : null}
      </Notice>
    );
  return (
    <section
      aria-label={lens === 'population' ? 'Population' : 'Compare'}
      aria-busy={checking || undefined}
      role="status"
      data-testid="studio-readiness"
      data-phase={readiness.phase}
      className="flex min-h-[220px] flex-1 rounded-sm border border-border bg-card p-6"
    >
      <EmptyPane
        title={readiness.title}
        hint={
          <>
            <span className="mx-auto block max-w-[46ch]">{readiness.detail}</span>
            {checking ? (
              readiness.progress ? (
                // Counted: a bar that fills as the headers are read.
                <span
                  role="progressbar"
                  aria-label="Checking image grids"
                  aria-valuemin={0}
                  aria-valuemax={readiness.progress.total}
                  aria-valuenow={readiness.progress.read}
                  aria-valuetext={`${readiness.progress.read} of ${readiness.progress.total} image headers read`}
                  className="mx-auto mt-3 block h-0.5 w-48 max-w-full overflow-hidden bg-bf-border-subtle"
                >
                  <span
                    className="block h-full bg-primary motion-safe:transition-[width] motion-safe:duration-200"
                    style={{
                      width: `${Math.round((100 * readiness.progress.read) / readiness.progress.total)}%`,
                    }}
                  />
                </span>
              ) : (
                <span
                  role="progressbar"
                  aria-label="Checking image grids"
                  className="mx-auto mt-3 block h-0.5 w-48 max-w-full overflow-hidden bg-bf-border-subtle"
                >
                  <span className="block h-full w-full animate-pulse bg-primary" />
                </span>
              )
            ) : null}
          </>
        }
        primary={
          reconnect && action && action !== 'cancel'
            ? reconnect
            : action && action !== 'cancel'
              ? {
                  label: ACTION_LABEL[action],
                  onClick: () => runAction(action),
                  testId: 'studio-readiness-action',
                }
              : null
        }
        secondary={
          reconnect && action && action !== 'cancel'
            ? {
                label: ACTION_LABEL[action],
                onClick: () => runAction(action),
                testId: 'studio-readiness-action',
              }
            : action === 'cancel'
            ? {
                label: ACTION_LABEL.cancel,
                onClick: () => runAction('cancel'),
                testId: 'studio-readiness-action',
              }
            : null
        }
      />
    </section>
  );
}
