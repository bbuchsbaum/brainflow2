/**
 * A Series locus that cannot be resolved (v1 function 7): one alert shape for
 * the dataset and the 4D-layer series, a message and the action that fixes it
 * ("Load atlas…" for a region without an atlas, "Open Clusters" for a cluster
 * without a selected row).
 */
import { useState } from 'react';
import { AtlasPicker } from '@/components/inspector/imaging/InspectorLoadDialogs';
import { openDockTab } from '@/components/layout/openDockTab';
import { Button, Notice } from '@/components/ui/bf';

import type { SeriesIssueAction } from './seriesIssue.helpers';

export function SeriesIssue({ message, action }: { message: string; action: SeriesIssueAction }) {
  const [atlasPicker, setAtlasPicker] = useState(false);
  return (
    <>
      <Notice severity="danger" role="alert" className="shrink-0" data-testid="series-issue">
        <span>No series: {message}</span>
        {action === 'atlas' ? (
          <Button
            variant="secondary"
            size="sm"
            className="ml-2"
            onClick={() => setAtlasPicker(true)}
          >
            Load atlas…
          </Button>
        ) : action === 'clusters' ? (
          <Button
            variant="secondary"
            size="sm"
            className="ml-2"
            onClick={() => openDockTab('clusters', { focus: true })}
          >
            Open Clusters
          </Button>
        ) : null}
      </Notice>
      {atlasPicker ? <AtlasPicker onClose={() => setAtlasPicker(false)} /> : null}
    </>
  );
}
