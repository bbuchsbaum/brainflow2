import React, { useState } from 'react';
import type { BidsSliceImage } from '@brainflow/api';
import { Modal } from '@/components/ui/Modal';
import { RunSlice } from '@/components/inspector/bids/BidsSliceImage';
import { formatZ } from '@/components/inspector/bids/bidsSlices';
import { useBidsModel, useBidsStore } from '@/stores/bidsStore';
import { runLabel } from '@/stores/bidsModel';

const QUICK_LOOK_PX = 512;

/** Space: the selected run's slice at size. Esc, or Space on the close button, ends it. */
export function BidsQuickLook({ runId, onClose }: { runId: string; onClose: () => void }) {
  const model = useBidsModel();
  const datasetPath = useBidsStore((state) => state.datasetPath);
  const [image, setImage] = useState<BidsSliceImage | null>(null);
  const facts = model.runsById.get(runId);
  if (!facts) return null;
  return (
    <Modal isOpen onClose={onClose} title={runLabel(facts.run)} size="xl" bodyClassName="p-3">
      <RunSlice
        run={facts.run}
        className="aspect-square"
        datasetPath={datasetPath}
        maxPx={QUICK_LOOK_PX}
        alt={`${runLabel(facts.run)}, axial slice`}
        onImage={setImage}
      />
      {image ? (
        <p className="m-0 mt-2 font-mono text-bf-xs text-bf-text-faint" data-testid="bids-quick-look-caption">
          {[
            formatZ(image.world_z_mm),
            `${image.volumes_used} ${image.volumes_used === 1 ? 'volume' : 'volumes'}`,
            '2nd to 98th percentile window',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
    </Modal>
  );
}
