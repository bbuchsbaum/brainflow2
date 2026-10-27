import { Button, Notice } from '@/components/ui/bf';
import { openDockTab } from '@/components/layout/openDockTab';

/**
 * Stand-in for a ClusterPanel tab restored from an old saved layout: the
 * cluster table now lives in the bottom dock's Clusters tab (P3.5).
 */
export function ClusterPanelMoved() {
  return (
    <div className="p-3">
      <Notice
        role={undefined}
        action={
          <Button variant="secondary" size="sm" onClick={() => openDockTab('clusters')}>
            Open Clusters
          </Button>
        }
      >
        Clusters moved to the bottom dock.
      </Notice>
    </div>
  );
}
