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
import {
  handleNumericPasteText,
  parseNumericList,
  parseNumericText,
} from '@/utils/numericInput';

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
  // Fields the browser reports as unparseable (`validity.badInput`): their
  // value reads "" although the user typed something.
  const [badInput, setBadInput] = useState<Record<'x' | 'y' | 'z', boolean>>({
    x: false,
    y: false,
    z: false,
  });
  // Pasted text refused as not a number (the field keeps its previous value).
  const [refusedPaste, setRefusedPaste] = useState<Record<'x' | 'y' | 'z', boolean>>({
    x: false,
    y: false,
    z: false,
  });

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
    if (isUnparseable('x') || isUnparseable('y') || isUnparseable('z')) return null;
    // Strict parse with minus-like dashes normalised: "−37.5" is -37.5, and
    // anything that is not a whole number is rejected, never reinterpreted.
    const x = parseNumericText(inputs.x);
    const y = parseNumericText(inputs.y);
    const z = parseNumericText(inputs.z);
    if (x === null || y === null || z === null) return null;
    return [x, y, z];
  };

  /** Not a number (shown invalid; an empty field only disables Go). */
  function isUnparseable(axis: 'x' | 'y' | 'z'): boolean {
    return (
      badInput[axis] ||
      refusedPaste[axis] ||
      (inputs[axis].trim() !== '' && parseNumericText(inputs[axis]) === null)
    );
  }

  /**
   * Paste: a coordinate triple (e.g. the status bar's "(−37.5, −18.5, 17.5)")
   * fills X, Y and Z; a single number is normalised into this field; anything
   * else is refused and the field shows its invalid state.
   */
  const handlePaste = (axis: 'x' | 'y' | 'z') => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const raw = e.clipboardData.getData('text/plain');
    if (!raw) return;
    const list = parseNumericList(raw);
    if (list && list.length === 3) {
      e.preventDefault();
      setInputs({ x: String(list[0]), y: String(list[1]), z: String(list[2]) });
      setBadInput({ x: false, y: false, z: false });
      setRefusedPaste({ x: false, y: false, z: false });
      return;
    }
    if (parseNumericText(raw) !== null) {
      // One number: normalised into the field at the caret.
      handleNumericPasteText(e.currentTarget, raw, e.nativeEvent);
      return;
    }
    // Refused (value unchanged): the field shows invalid until it is edited.
    e.preventDefault();
    setRefusedPaste(prev => ({ ...prev, [axis]: true }));
  };

  const isOutOfBounds = (axis: 'x' | 'y' | 'z'): boolean => {
    if (!bounds || space !== 'world') return false;
    const val = parseNumericText(inputs[axis]);
    if (val === null) return false;
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
  }, [inputs, badInput, refusedPaste, space, setCrosshair, onClose, layers]);

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
    const bad = isUnparseable(axis);
    return [
      'w-full px-3 py-1.5 rounded-sm text-sm font-mono tabular-nums bg-bf-bg-input text-foreground',
      'border focus:outline-none focus:ring-2',
      bad
        ? 'border-bf-danger focus:ring-bf-danger'
        : oob
          ? 'border-bf-warning focus:ring-bf-warning'
          : 'border-border focus:ring-ring',
    ].join(' ');
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Go to coordinate"
      ariaLabel="Go to coordinate"
      size="sm"
      initialFocusRef={firstInputRef}
      bodyClassName="p-0"
      className="max-w-xs rounded-sm ring-1 ring-bf-border-strong shadow-2xl"
    >
      <div className="px-5 py-4 space-y-4">
          {/* Space toggle: one joined segmented group */}
          <div className="flex items-stretch rounded-sm border border-border" role="group" aria-label="Coordinate space">
            <button
              type="button"
              aria-pressed={space === 'world'}
              onClick={() => setSpace('world')}
              className={[
                'relative flex-1 py-1.5 text-bf-xs font-medium transition-colors border-r border-bf-border-subtle focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                space === 'world'
                  ? 'bg-bf-bg-active text-foreground shadow-[inset_0_-2px_0_var(--bf-text-muted)]'
                  : 'bg-bf-bg-input text-muted-foreground hover:bg-accent hover:text-foreground',
              ].join(' ')}
            >
              World (mm)
            </button>
            <button
              type="button"
              aria-pressed={space === 'voxel'}
              onClick={() => setSpace('voxel')}
              className={[
                'relative flex-1 py-1.5 text-bf-xs font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                space === 'voxel'
                  ? 'bg-bf-bg-active text-foreground shadow-[inset_0_-2px_0_var(--bf-text-muted)]'
                  : 'bg-bf-bg-input text-muted-foreground hover:bg-accent hover:text-foreground',
              ].join(' ')}
            >
              Voxel
            </button>
          </div>

          {/* Coordinate inputs */}
          <div className="grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis} className="space-y-1">
                <Label htmlFor={`goto-${axis}`} className="text-bf-sm text-muted-foreground">
                  {axis.toUpperCase()}
                </Label>
                <input
                  id={`goto-${axis}`}
                  aria-label={`${axis.toUpperCase()} ${space === 'world' ? '(mm)' : '(voxel index)'}`}
                  aria-invalid={isUnparseable(axis) || isOutOfBounds(axis) || undefined}
                  aria-describedby={isUnparseable(axis) ? 'goto-invalid' : undefined}
                  data-numeric-paste="self"
                  ref={axis === 'x' ? firstInputRef : undefined}
                  type="number"
                  value={inputs[axis]}
                  onChange={e => {
                    const bad = e.target.validity?.badInput === true;
                    setBadInput(prev => (prev[axis] === bad ? prev : { ...prev, [axis]: bad }));
                    setRefusedPaste(prev => (prev[axis] ? { ...prev, [axis]: false } : prev));
                    setInputs(prev => ({ ...prev, [axis]: e.target.value }));
                  }}
                  onPaste={handlePaste(axis)}
                  className={inputClass(axis)}
                  step={space === 'world' ? '0.1' : '1'}
                />
              </div>
            ))}
          </div>

          {(['x', 'y', 'z'] as const).some(a => isUnparseable(a)) && (
            <p id="goto-invalid" className="text-xs text-bf-danger" role="alert">
              {(['x', 'y', 'z'] as const)
                .filter(a => isUnparseable(a))
                .map(a => (refusedPaste[a] ? `Pasted ${a.toUpperCase()}` : a.toUpperCase()))
                .join(', ')}{' '}
              is not a number.
            </p>
          )}

          {/* Bounds warning */}
          {bounds && (['x', 'y', 'z'] as const).some(a => isOutOfBounds(a)) && (
            <p className="text-xs text-bf-warning" role="status">
              Coordinate is outside volume bounds.
            </p>
          )}
      </div>

      <div
        className="px-5 py-3 border-t flex items-center justify-between gap-2"
        style={{ borderColor: 'var(--bf-border-subtle)' }}
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
