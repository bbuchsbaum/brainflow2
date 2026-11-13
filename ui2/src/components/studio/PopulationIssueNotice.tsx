import { Button, Notice } from '@/components/ui/bf';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { populationReadinessIssue } from '@/services/studio/populationReadiness';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStudioReadiness } from '@/hooks/useStudioReadiness';
import { useRecoverOnReconnect } from '@/hooks/useRemoteReconnect';
import { RemoteReconnectButton } from '@/components/ui/RemoteReconnectButton';

/**
 * A message above the Population maps. An error of the calculation is drawn
 * as one. A set that is not ready to be read together is not an error: its
 * state (the grid check running, headers nobody has read, a check that could
 * not read them, grids that differ) is said calmly, with the action that
 * helps. In the Studio the lens shows that state on its own instead of the
 * maps (LensCanvas, StudioReadinessNotice); this covers the lens used alone.
 */
export function PopulationIssueNotice({ issue }: { issue: string }) {
  const activeSet = useSetStudioStore((state) =>
    state.selection.activeSetId ? (state.sets[state.selection.activeSetId] ?? null) : null,
  );
  const readiness = useStudioReadiness('population');
  // A check that failed on a dropped connection runs again when the mount is back.
  useRecoverOnReconnect(readiness.reconnectPath, readiness.phase === 'check-failed', () => {
    void getSetIngestionService().checkActiveSetGrids();
  });
  const isReadiness = populationReadinessIssue(activeSet)?.message === issue;
  if (!isReadiness || readiness.phase === 'ready')
    return (
      <Notice role="alert" severity="danger">
        {issue}
      </Notice>
    );
  const { action } = readiness;
  const checking = readiness.phase === 'checking';
  const service = getSetIngestionService();
  const retryAction = action ? (
    <Button
      variant="link"
      size="sm"
      className="min-h-6 shrink-0"
      aria-label={action === 'cancel' ? 'Cancel image grid check' : undefined}
      onClick={() => {
        if (action === 'cancel') service.cancelGridCheck();
        else void service.checkActiveSetGrids();
      }}
    >
      {action === 'cancel'
        ? 'Cancel'
        : action === 'retry'
          ? 'Retry'
          : action === 'continue'
            ? 'Continue checking'
            : 'Check image grids'}
    </Button>
  ) : undefined;
  return (
    <Notice
      severity={
        readiness.phase === 'check-failed' || readiness.phase === 'unavailable'
          ? 'warning'
          : 'neutral'
      }
      data-phase={readiness.phase}
      aria-busy={checking || undefined}
      action={
        readiness.reconnectPath ? (
          <span className="flex shrink-0 items-center gap-2">
            <RemoteReconnectButton
              path={readiness.reconnectPath}
              variant="link"
              className="min-h-6 shrink-0"
            />
            {retryAction}
          </span>
        ) : (
          retryAction
        )
      }
    >
      <span className="font-medium text-foreground">{readiness.title}</span> {readiness.detail}
    </Notice>
  );
}
