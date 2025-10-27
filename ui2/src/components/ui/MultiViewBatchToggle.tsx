import { Switch } from '@/components/ui/shadcn/switch';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { cn } from '@/utils/cn';

interface MultiViewBatchToggleProps {
  className?: string;
}

export function MultiViewBatchToggle({ className }: MultiViewBatchToggleProps) {
  const enabled = useFeatureFlagStore((state) => state.multiViewBatch);
  const setEnabled = useFeatureFlagStore((state) => state.setMultiViewBatchEnabled);

  return (
    <div className={cn('status-toggle', className)}>
      <span>Multi-view Batch</span>
      <Switch
        checked={enabled}
        onCheckedChange={(value) => setEnabled(Boolean(value))}
        aria-label="Toggle multi-view batch rendering"
      />
    </div>
  );
}
