/** H's narrow tool rail, with live controls for the manual tracing milestone. */
import React from 'react';
import { Brush, Eraser, MousePointer2, PenTool } from 'lucide-react';
import { IconButton } from '@/components/ui/bf';
import type { SegmentationTool } from '@brainflow/api';
const tools = [
  { id: 'navigate', title: 'Navigate', key: 'V', icon: <MousePointer2 /> },
  { id: 'brush', title: 'Brush', key: 'B', icon: <Brush /> },
  { id: 'eraser', title: 'Eraser', key: 'E', icon: <Eraser /> },
  { id: 'contour', title: 'Contour', key: 'C', icon: <PenTool /> },
] as const;
export function TracingTools({ active, disabled, onSelect }: { active: 'navigate' | SegmentationTool; disabled: boolean; onSelect(tool: 'navigate' | SegmentationTool): void }) {
  return <nav aria-label="Segmentation tools" className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-bf-border-subtle bg-bf-bg-shell py-2">
    {tools.map((tool) => <IconButton key={tool.id} aria-label={`${tool.title} (${tool.key})`} title={`${tool.title} (${tool.key})`} icon={tool.icon} size="sm" pressed={active === tool.id} disabled={disabled && tool.id !== 'navigate'} onClick={() => onSelect(tool.id)} />)}
  </nav>;
}
