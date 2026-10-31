import { SegmentedControl } from '@/components/ui/bf';
import { useSetStudioStore } from '@/stores/setStudioStore';

const PLANES = [
  { value: 'axial', label: 'Axial' },
  { value: 'coronal', label: 'Coronal' },
  { value: 'sagittal', label: 'Sagittal' },
] as const;

/**
 * The plane the Deck's single view and the four Compare panes show, shared
 * by both lenses and kept for the session (QA N13 b/c).
 */
export function StudioPlaneToggle() {
  const plane = useSetStudioStore((state) => state.studioPlane);
  const setPlane = useSetStudioStore((state) => state.setStudioPlane);
  return (
    <SegmentedControl
      aria-label="Studio view plane"
      className="shrink-0"
      options={PLANES.map((option) => ({ ...option }))}
      value={plane}
      onValueChange={(value) => setPlane(value as typeof plane)}
      hideWhenSingle={false}
    />
  );
}
