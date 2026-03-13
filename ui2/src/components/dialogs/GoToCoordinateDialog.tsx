/**
 * GoToCoordinateDialog
 *
 * Modal dialog for navigating to a specific coordinate.
 * Supports World (mm) and Voxel coordinate spaces.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Modal } from '@/components/ui/Modal';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { getApiService } from '@/services/apiService';

interface GoToCoordinateDialogProps {
  open: boolean;
  onClose: () => void;
}

type CoordSpace = 'world' | 'voxel';

interface CoordInputs {
  x: string;
  y: string;
  z: string;
}

export function GoToCoordinateDialog({ open, onClose }: GoToCoordinateDialogProps) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [space, setSpace] = useState<CoordSpace>('world');
  const [inputs, setInputs] = useState<CoordInputs>({ x: '0', y: '0', z: '0' });
  const [bounds, setBounds] = useState<{ min: [number, number, number]; max: [number, number, number] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const crosshair = useViewStateStore(state => state.viewState.crosshair.world_mm);
  const setCrosshair = useViewStateStore(state => state.setCrosshair);
  const layers = useLayerStore(state => state.layers);

  // Load volume bounds when dialog opens
  useEffect(() => {
    if (!open) return;

    const visibleLayer = layers.find(l => l.volumeId);
    if (!visibleLayer?.volumeId) return;

    getApiService()
      .getVolumeBounds(visibleLayer.volumeId)
      .then(b => setBounds(b))
      .catch(() => setBounds(null));
  }, [open, layers]);

  // Pre-fill inputs with current crosshair when dialog opens
  useEffect(() => {
    if (!open) return;
    if (space === 'world') {
      setInputs({
        x: crosshair[0].toFixed(1),
        y: crosshair[1].toFixed(1),
        z: crosshair[2].toFixed(1),
      });
    }
    // For voxel space, we'd need a world-to-voxel conversion - default to 0,0,0 for now
  }, [open]); // Only on open, not on every crosshair change

  const parseCoords = (): [number, number, number] | null => {
    const x = parseFloat(inputs.x);
    const y = parseFloat(inputs.y);
    const z = parseFloat(inputs.z);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
    return [x, y, z];
  };

  const isOutOfBounds = (axis: 'x' | 'y' | 'z'): boolean => {
    if (!bounds || space !== 'world') return false;
    const val = parseFloat(inputs[axis]);
    if (isNaN(val)) return false;
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    return val < bounds.min[idx] || val > bounds.max[idx];
  };

  const handleGo = useCallback(async () => {
    const coords = parseCoords();
    if (!coords) return;

    setIsLoading(true);
    try {
      if (space === 'world') {
        await setCrosshair(coords, true);
      } else {
        // Voxel: attempt conversion via the first available volume's affine
        const visibleLayer = layers.find(l => l.volumeId);
        if (visibleLayer?.volumeId) {
          // For voxel mode, use coords directly as world for now
          // A proper implementation would call a voxel-to-world conversion endpoint
          await setCrosshair(coords, true);
        } else {
          await setCrosshair(coords, true);
        }
      }
      onClose();
    } finally {
      setIsLoading(false);
    }
  }, [inputs, space, setCrosshair, onClose, layers]);

  const handleCurrent = useCallback(() => {
    if (space === 'world') {
      setInputs({
        x: crosshair[0].toFixed(1),
        y: crosshair[1].toFixed(1),
        z: crosshair[2].toFixed(1),
      });
    }
  }, [crosshair, space]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleGo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleGo]);

  if (!open) return null;

  const inputClass = (axis: 'x' | 'y' | 'z') => {
    const oob = isOutOfBounds(axis);
    return [
      'w-full px-3 py-1.5 rounded text-sm font-mono tabular-nums bg-gray-800 text-gray-100',
      'border focus:outline-none focus:ring-1',
      oob
        ? 'border-amber-500 focus:ring-amber-500'
        : 'border-gray-600 focus:ring-blue-500',
    ].join(' ');
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Go to Coordinate"
      ariaLabel="Go to Coordinate"
      size="sm"
      initialFocusRef={firstInputRef}
      bodyClassName="p-0"
      className="max-w-xs rounded-xl ring-1 ring-white/10 shadow-2xl"
    >
      <div className="px-5 py-4 space-y-4">
          {/* Space toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSpace('world')}
              className={[
                'flex-1 py-1.5 text-xs font-medium rounded transition-colors',
                space === 'world'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200',
              ].join(' ')}
            >
              World (mm)
            </button>
            <button
              onClick={() => setSpace('voxel')}
              className={[
                'flex-1 py-1.5 text-xs font-medium rounded transition-colors',
                space === 'voxel'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200',
              ].join(' ')}
            >
              Voxel
            </button>
          </div>

          {/* Coordinate inputs */}
          <div className="grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis} className="space-y-1">
                <Label className="text-xs text-gray-400 uppercase">{axis}</Label>
                <input
                  ref={axis === 'x' ? firstInputRef : undefined}
                  type="number"
                  value={inputs[axis]}
                  onChange={e => setInputs(prev => ({ ...prev, [axis]: e.target.value }))}
                  className={inputClass(axis)}
                  step={space === 'world' ? '0.1' : '1'}
                />
              </div>
            ))}
          </div>

          {/* Bounds warning */}
          {bounds && (['x', 'y', 'z'] as const).some(a => isOutOfBounds(a)) && (
            <p className="text-xs text-amber-400">
              Coordinate is outside volume bounds.
            </p>
          )}
      </div>

      <div
        className="px-5 py-3 border-t flex items-center justify-between gap-2"
        style={{ borderColor: 'var(--app-border-subtle, #1e293b)' }}
      >
        <Button onClick={handleCurrent} variant="outline" size="sm" className="text-xs">
          Current
        </Button>
        <div className="flex gap-2">
          <Button onClick={onClose} variant="ghost" size="sm" className="text-xs">
            Cancel
          </Button>
          <Button
            onClick={handleGo}
            variant="default"
            size="sm"
            className="text-xs"
            disabled={isLoading || parseCoords() === null}
          >
            Go
          </Button>
        </div>
      </div>
    </Modal>
  );
}
