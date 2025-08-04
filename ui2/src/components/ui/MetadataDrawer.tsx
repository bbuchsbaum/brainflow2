/**
 * MetadataDrawer - Comprehensive metadata display panel
 * Slides out from the right side showing all volume metadata
 */

import React, { useState } from 'react';
import { useLayer, layerSelectors } from '@/stores/layerStore';
import type { VolumeMetadata } from '@/stores/layerStore';
import { 
  VscChevronDown,
  VscChevronRight,
  VscCopy,
  VscCheck,
  VscPin,
  VscPinned
} from 'react-icons/vsc';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/shadcn/sheet';
import { cn } from '@/utils/cn';

interface MetadataDrawerProps {
  layerId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isPinned?: boolean;
  onPinToggle?: () => void;
}

interface MetadataSection {
  title: string;
  fields: Array<{
    label: string;
    value: string | null;
    copyable?: boolean;
    mono?: boolean;
  }>;
}

export function MetadataDrawer({ layerId, isOpen, onOpenChange, isPinned = false, onPinToggle }: MetadataDrawerProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic', 'spatial']));
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  // Get layer and metadata using typed selectors
  const layer = useLayer(state => layerSelectors.getLayerById(state, layerId));
  const metadata = useLayer(state => layerSelectors.getLayerMetadata(state, layerId)) || null;
  
  if (!layer || !metadata) {
    return null;
  }
  
  // Copy to clipboard
  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  // Toggle section expansion
  const toggleSection = (sectionTitle: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionTitle)) {
        next.delete(sectionTitle);
      } else {
        next.add(sectionTitle);
      }
      return next;
    });
  };
  
  // Build metadata sections
  const sections: MetadataSection[] = [
    {
      title: 'Basic Information',
      fields: [
        { label: 'Layer Name', value: layer.name },
        { label: 'File Path', value: metadata.filePath || 'Unknown', copyable: true },
        { label: 'Format', value: metadata.fileFormat || 'Unknown' },
        { label: 'Data Type', value: metadata.dataType || 'Unknown' }
      ]
    },
    {
      title: 'Spatial Properties',
      fields: [
        { 
          label: 'Dimensions', 
          value: metadata.dimensions ? metadata.dimensions.join(' × ') + ' voxels' : null,
          mono: true
        },
        { 
          label: 'Resolution', 
          value: metadata.spacing ? metadata.spacing.map(s => s.toFixed(3)).join(' × ') + ' mm' : null,
          mono: true
        },
        { 
          label: 'Origin', 
          value: metadata.origin ? metadata.origin.map(o => o.toFixed(1)).join(', ') : null,
          mono: true,
          copyable: true
        },
        {
          label: 'Orientation',
          value: metadata.orientation || 'Unknown'
        },
        {
          label: 'Units',
          value: metadata.units || 'millimeters'
        }
      ]
    },
    {
      title: 'Data Statistics',
      fields: [
        {
          label: 'Data Range',
          value: metadata.dataRange ? `[${metadata.dataRange.min.toFixed(2)}, ${metadata.dataRange.max.toFixed(2)}]` : null,
          mono: true
        },
        {
          label: 'Total Voxels',
          value: metadata.totalVoxels ? metadata.totalVoxels.toLocaleString() : null,
          mono: true
        },
        {
          label: 'Non-Zero Voxels',
          value: metadata.nonZeroVoxels ? 
            `${metadata.nonZeroVoxels.toLocaleString()} (${((metadata.nonZeroVoxels / (metadata.totalVoxels || 1)) * 100).toFixed(1)}%)` : 
            null,
          mono: true
        },
        {
          label: 'Binary Mask',
          value: metadata.isBinaryLike ? 'Yes' : 'No'
        }
      ]
    },
    {
      title: 'World Bounds',
      fields: [
        {
          label: 'Min (LPI)',
          value: metadata.worldBounds ? 
            metadata.worldBounds.min.map(v => v.toFixed(1)).join(', ') : null,
          mono: true,
          copyable: true
        },
        {
          label: 'Max (LPI)', 
          value: metadata.worldBounds ?
            metadata.worldBounds.max.map(v => v.toFixed(1)).join(', ') : null,
          mono: true,
          copyable: true
        },
        {
          label: 'Center',
          value: metadata.centerWorld ?
            metadata.centerWorld.map(v => v.toFixed(1)).join(', ') : null,
          mono: true,
          copyable: true
        }
      ]
    },
    {
      title: 'Transformation Matrices',
      fields: [
        {
          label: 'Voxel to World',
          value: metadata.voxelToWorld ? 
            formatMatrix(metadata.voxelToWorld) : null,
          mono: true,
          copyable: true
        },
        {
          label: 'World to Voxel',
          value: metadata.worldToVoxel ?
            formatMatrix(metadata.worldToVoxel) : null,
          mono: true,
          copyable: true
        }
      ]
    }
  ];
  
  // Format 4x4 matrix
  function formatMatrix(matrix: number[]): string {
    if (matrix.length !== 16) return 'Invalid matrix';
    
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const row = matrix.slice(i * 4, (i + 1) * 4)
        .map(v => v.toFixed(3).padStart(8))
        .join(' ');
      rows.push(row);
    }
    return rows.join('\n');
  }
  
  return (
    <Sheet open={isOpen} onOpenChange={isPinned ? undefined : onOpenChange}>
      <SheetContent 
        className="w-[28rem] sm:max-w-[28rem] p-0 flex flex-col"
        onInteractOutside={isPinned ? (e) => e.preventDefault() : undefined}
      >
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle>Volume Metadata</SheetTitle>
            <div className="flex items-center gap-2">
              {onPinToggle && (
                <button
                  onClick={onPinToggle}
                  className={cn(
                    "p-2 rounded-md transition-colors",
                    "hover:bg-accent/20",
                    "text-muted-foreground hover:text-foreground"
                  )}
                  title={isPinned ? "Unpin drawer" : "Pin drawer"}
                  aria-label={isPinned ? "Unpin drawer" : "Pin drawer"}
                >
                  {isPinned ? (
                    <VscPinned className="w-4 h-4" />
                  ) : (
                    <VscPin className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
          <SheetDescription>
            Detailed information about {layer.name}
          </SheetDescription>
        </SheetHeader>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {sections.map(section => {
            const isExpanded = expandedSections.has(section.title.toLowerCase().replace(/\s+/g, ''));
            const sectionKey = section.title.toLowerCase().replace(/\s+/g, '');
            
            return (
              <div
                key={section.title}
                className={cn(
                  "rounded-lg overflow-hidden",
                  "border bg-card"
                )}
              >
                {/* Section header */}
                <button
                  onClick={() => toggleSection(sectionKey)}
                  className={cn(
                    "w-full flex items-center justify-between p-3",
                    "hover:bg-accent/10 transition-colors"
                  )}
                >
                  <h3 className="font-medium text-sm">
                    {section.title}
                  </h3>
                  <div className="text-muted-foreground">
                    {isExpanded ? (
                      <VscChevronDown className="w-4 h-4" />
                    ) : (
                      <VscChevronRight className="w-4 h-4" />
                    )}
                  </div>
                </button>
                
                {/* Section content */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t">
                    {section.fields.map(field => {
                      if (!field.value) return null;
                      
                      const fieldKey = `${section.title}-${field.label}`;
                      const isCopied = copiedField === fieldKey;
                      
                      return (
                        <div key={field.label} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">
                              {field.label}
                            </span>
                            {field.copyable && (
                              <button
                                onClick={() => copyToClipboard(field.value!, fieldKey)}
                                className={cn(
                                  "p-1 rounded transition-all",
                                  "hover:bg-accent/20",
                                  isCopied ? "text-green-500" : "text-muted-foreground hover:text-foreground"
                                )}
                                title="Copy to clipboard"
                              >
                                {isCopied ? (
                                  <VscCheck className="w-3 h-3" />
                                ) : (
                                  <VscCopy className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                          <div 
                            className={cn(
                              "text-sm break-all",
                              field.mono && "font-mono bg-muted/50 px-2 py-1 rounded",
                              field.label.includes('Matrix') && "whitespace-pre text-xs bg-muted p-2 rounded"
                            )}
                          >
                            {field.value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default MetadataDrawer;