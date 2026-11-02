import React from 'react';
import type { BidsRunRecord, BidsSliceImage as SliceImage, BidsSliceRequest } from '@brainflow/api';
import { useBidsResource } from '@/hooks/useBidsResource';
import { cn } from '@/utils/cn';
import { fetchSlice, isImageUnavailable, sliceKind } from './bidsSlices';

export function SliceTile({
  image,
  alt,
  className,
}: {
  image: SliceImage;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={`data:image/png;base64,${image.png_base64}`}
      alt={alt}
      className={cn('block h-full w-full object-contain', className)}
    />
  );
}

const Frame = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div
    className={cn(
      'flex aspect-[3/2] min-w-0 items-center justify-center overflow-hidden bg-bf-bg-canvas',
      className,
    )}
  >
    {children}
  </div>
);

const FrameText = ({ children, role }: { children: React.ReactNode; role?: string }) => (
  <span role={role} className="px-2 text-center text-bf-2xs text-bf-text-muted">
    {children}
  </span>
);

interface RunSliceProps {
  run: BidsRunRecord;
  kind?: string;
  maxPx?: number;
  alt: string;
  worldZ?: number | null;
  datasetPath: string | null;
  className?: string;
  onImage?: (image: SliceImage) => void;
}

/** One run's slice, with its own loading, missing and failed states. */
export function RunSlice({
  run,
  kind,
  maxPx = 256,
  alt,
  worldZ = null,
  datasetPath,
  className,
  onImage,
}: RunSliceProps) {
  const unavailable = isImageUnavailable(run);
  const request: BidsSliceRequest = {
    path: run.path,
    kind: kind ?? sliceKind(run),
    world_z_mm: worldZ,
    max_px: maxPx,
  };
  const resource = useBidsResource(
    unavailable ? null : `${datasetPath}|${JSON.stringify(request)}`,
    () => fetchSlice(request),
  );
  React.useEffect(() => {
    if (resource.status === 'ready') onImage?.(resource.data);
    // Reports each new image once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.status, resource.data]);
  return (
    <Frame className={className}>
      {unavailable ? (
        <FrameText>Image not available here: annexed and not fetched.</FrameText>
      ) : resource.status === 'ready' ? (
        <SliceTile image={resource.data} alt={alt} />
      ) : resource.status === 'error' ? (
        <FrameText role="alert">Image could not be read: {resource.error}</FrameText>
      ) : (
        <FrameText>Loading…</FrameText>
      )}
    </Frame>
  );
}

export { Frame as SliceFrame, FrameText as SliceFrameText };
