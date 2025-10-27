/**
 * SurfaceMetadataDrawer - Comprehensive metadata display for surfaces
 * Shows surface properties, mesh statistics, and coordinate information
 */

import React, { useState } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
import type { Surface } from '@/stores/surfaceStore';
import { 
  VscChevronDown,
  VscChevronRight,
  VscCopy,
  VscCheck,
  VscClose,
  VscInfo
} from 'react-icons/vsc';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/shadcn/sheet';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/Button';

interface SurfaceMetadataDrawerProps {
  surfaceId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MetadataSection {
  title: string;
  fields: Array<{
    label: string;
    value: string | number | null;
    copyable?: boolean;
    mono?: boolean;
  }>;
}

export function SurfaceMetadataDrawer({ 
  surfaceId, 
  isOpen, 
  onOpenChange 
}: SurfaceMetadataDrawerProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['mesh', 'properties'])
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  // Get surface from store
  const surface = useSurfaceStore(state => 
    state.surfaces.get(surfaceId)
  );
  
  if (!surface) {
    return null;
  }
  
  // Copy to clipboard
  const handleCopy = async (label: string, value: string | number | null) => {
    if (value === null) return;
    
    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
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
  
  // Format file size
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };
  
  // Format number with commas
  const formatNumber = (num?: number): string => {
    if (num === undefined) return 'Unknown';
    return num.toLocaleString();
  };
  
  // Build metadata sections
  const sections: MetadataSection[] = [
    {
      title: 'Basic Information',
      fields: [
        { label: 'Name', value: surface.name || 'Unnamed Surface' },
        { label: 'Handle', value: surface.handle, copyable: true, mono: true },
        { label: 'Path', value: surface.path || 'N/A', copyable: true, mono: true },
        { label: 'Visible', value: surface.visible ? 'Yes' : 'No' },
      ]
    },
    {
      title: 'Mesh Statistics',
      fields: [
        { 
          label: 'Vertices', 
          value: formatNumber(surface.metadata?.vertexCount),
          copyable: true 
        },
        { 
          label: 'Faces', 
          value: formatNumber(surface.metadata?.faceCount),
          copyable: true 
        },
        { 
          label: 'Hemisphere', 
          value: surface.metadata?.hemisphere || 'Unknown' 
        },
        { 
          label: 'Surface Type', 
          value: surface.metadata?.surfaceType || 'Unknown' 
        },
      ]
    },
    {
      title: 'Coordinate System',
      fields: [
        { 
          label: 'Space', 
          value: surface.metadata?.coordinateSpace || 'Native' 
        },
        { 
          label: 'Units', 
          value: surface.metadata?.units || 'mm' 
        },
        {
          label: 'Bounds X',
          value: surface.metadata?.bounds ? 
            `[${surface.metadata.bounds.min[0].toFixed(2)}, ${surface.metadata.bounds.max[0].toFixed(2)}]` : 
            'Unknown',
          mono: true
        },
        {
          label: 'Bounds Y',
          value: surface.metadata?.bounds ? 
            `[${surface.metadata.bounds.min[1].toFixed(2)}, ${surface.metadata.bounds.max[1].toFixed(2)}]` : 
            'Unknown',
          mono: true
        },
        {
          label: 'Bounds Z',
          value: surface.metadata?.bounds ? 
            `[${surface.metadata.bounds.min[2].toFixed(2)}, ${surface.metadata.bounds.max[2].toFixed(2)}]` : 
            'Unknown',
          mono: true
        },
      ]
    },
    {
      title: 'Memory Usage',
      fields: [
        { 
          label: 'Vertex Buffer', 
          value: formatFileSize(surface.metadata?.vertexCount ? surface.metadata.vertexCount * 3 * 4 : undefined),
        },
        { 
          label: 'Face Buffer', 
          value: formatFileSize(surface.metadata?.faceCount ? surface.metadata.faceCount * 3 * 4 : undefined),
        },
        { 
          label: 'Total Estimated', 
          value: formatFileSize(
            surface.metadata?.vertexCount && surface.metadata?.faceCount ?
            (surface.metadata.vertexCount * 3 * 4) + (surface.metadata.faceCount * 3 * 4) : 
            undefined
          ),
        },
      ]
    },
  ];
  
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-lg font-semibold">
                Surface Metadata
              </SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground mt-1">
                {surface.name || 'Surface'} Properties
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
            >
              <VscClose className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>
        
        <div className="mt-6 space-y-4">
          {sections.map((section) => (
            <div key={section.title} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection(section.title)}
                className="w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors flex items-center justify-between"
              >
                <span className="text-sm font-medium">{section.title}</span>
                {expandedSections.has(section.title) ? (
                  <VscChevronDown className="h-4 w-4" />
                ) : (
                  <VscChevronRight className="h-4 w-4" />
                )}
              </button>
              
              {expandedSections.has(section.title) && (
                <div className="p-4 space-y-3">
                  {section.fields.map((field) => (
                    <div key={field.label} className="flex items-start justify-between">
                      <span className="text-sm text-muted-foreground">
                        {field.label}:
                      </span>
                      <div className="flex items-center gap-1">
                        <span className={cn(
                          "text-sm",
                          field.mono && "font-mono text-xs"
                        )}>
                          {String(field.value || 'N/A')}
                        </span>
                        {field.copyable && field.value !== null && (
                          <button
                            onClick={() => handleCopy(field.label, field.value)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title="Copy to clipboard"
                          >
                            {copiedField === field.label ? (
                              <VscCheck className="h-3 w-3 text-green-500" />
                            ) : (
                              <VscCopy className="h-3 w-3 text-muted-foreground" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        
        <div className="mt-6 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <VscInfo className="h-4 w-4" />
            <span>
              Surface handle: <code className="font-mono text-xs">{surface.handle}</code>
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}