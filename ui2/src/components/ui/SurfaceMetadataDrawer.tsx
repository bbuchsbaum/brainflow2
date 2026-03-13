/**
 * SurfaceMetadataDrawer - Comprehensive metadata display for surfaces
 * Shows surface properties, mesh statistics, and coordinate information
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSurfaceStore } from '@/stores/surfaceStore';
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
  id: string;
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
    new Set(['basic', 'mesh'])
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  
  // Get surface from store
  const surface = useSurfaceStore(state => 
    state.surfaces.get(surfaceId)
  );

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);
  
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
  const sections: MetadataSection[] = useMemo(() => {
    if (!surface) {
      return [];
    }

    return [
    {
      id: 'basic',
      title: 'Basic Information',
      fields: [
        { label: 'Name', value: surface.name || 'Unnamed Surface' },
        { label: 'Handle', value: surface.handle, copyable: true, mono: true },
        { label: 'Path', value: surface.metadata.path || 'N/A', copyable: true, mono: true },
        { label: 'Visible', value: surface.visible ? 'Yes' : 'No' },
      ]
    },
    {
      id: 'mesh',
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
      id: 'geometry',
      title: 'Geometry',
      fields: [
        { 
          label: 'Geometry Loaded',
          value:
            surface.geometry.vertices.length > 0 && surface.geometry.faces.length > 0
              ? 'Yes'
              : 'Pending',
        },
        { 
          label: 'Vertex Components',
          value: formatNumber(surface.geometry.vertices.length),
        },
        {
          label: 'Face Indices',
          value: formatNumber(surface.geometry.faces.length),
        },
      ]
    },
    {
      id: 'memory',
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
  }, [surface]);

  if (!surface) {
    return null;
  }
  
  // Copy to clipboard
  const handleCopy = async (label: string, value: string | number | null) => {
    if (value === null || !navigator.clipboard?.writeText) return;
    
    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedField(label);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopiedField(null);
        resetTimerRef.current = null;
      }, 2000);
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
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
              aria-label="Close surface metadata"
            >
              <VscClose className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>
        
        <div className="mt-6 space-y-4">
          {sections.map((section) => (
            <div key={section.title} className="border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={expandedSections.has(section.id)}
                aria-controls={`surface-metadata-section-${section.id}`}
                className="w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors flex items-center justify-between"
              >
                <span className="text-sm font-medium">{section.title}</span>
                {expandedSections.has(section.id) ? (
                  <VscChevronDown className="h-4 w-4" />
                ) : (
                  <VscChevronRight className="h-4 w-4" />
                )}
              </button>
              
              {expandedSections.has(section.id) && (
                <div id={`surface-metadata-section-${section.id}`} className="p-4 space-y-3">
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
                            type="button"
                            onClick={() => handleCopy(field.label, field.value)}
                            aria-label={copiedField === field.label ? `${field.label} copied` : `Copy ${field.label}`}
                            data-copied={copiedField === field.label}
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
