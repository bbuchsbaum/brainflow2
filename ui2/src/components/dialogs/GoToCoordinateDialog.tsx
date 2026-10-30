/**
 * GoToCoordinateDialog
 *
 * Modal dialog for navigating to a specific coordinate.
 * Supports World (mm) and Voxel coordinate spaces. Voxel indices are on
 * the selected layer's grid, named in the dialog ("ijk on the grid of
 * zstat1"), the same grid as the status bar's ijk and the cluster table
 * (`useReadoutGrid`; the bottom volume's grid when the selected layer has no
 * affine). They are converted to world mm through that grid's voxel-to-world
 * affine (the backend's column-major `voxelToWorld`) before navigating.
 * World bounds are checked against the first layer with a volume.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, FieldRow, Notice, NumberField, SegmentedControl } from '@/components/ui/bf';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { getApiService } from '@/services/apiService';
import { useReadoutGrid } from '@/hooks/useReadoutGrid';
import { nearestVoxelIndex } from '@/utils/voxelSnap';
import {
  isAffine4x4,
  transformVoxelToWorldColumnMajor,
  transformWorldToVoxelColumnMajor,
} from '@/utils/voxelTransform';
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

const SPACE_OPTIONS = [
  { value: 'world', label: 'World (mm)' },
  { value: 'voxel', label: 'Voxel' },
] as const;

interface CoordInputs {
  x: string;
  y: string;
  z: string;
}

export function GoToCoordinateDialog({ open, onClose }: GoToCoordinateDialogProps) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const goButtonRef = useRef<HTMLButtonElement>(null);
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
  const grid = useReadoutGrid();
  const voxelToWorld = isAffine4x4(grid?.voxelToWorld) ? grid!.voxelToWorld : null;
  const worldToVoxel = isAffine4x4(grid?.worldToVoxel) ? grid!.worldToVoxel : null;
  const dims = grid?.dims ?? null;
  // Voxel mode needs the affine: without it Go stays disabled (never a
  // silent "indices as mm").
  const voxelUnavailable = space === 'voxel' && !voxelToWorld;

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
  }, [open]); // Only on open, not on every crosshair change

  /**
   * Switching the coordinate space converts what is typed, so the numbers on
   * screen never silently change meaning: world mm -> nearest voxel index
   * (rounded integers) through `worldToVoxel`, voxel index -> world mm
   * through `voxelToWorld`. Without the needed affine, or for fields that are
   * empty or not numbers, the text is left as it is.
   */
  // The last conversion: switching straight back without an edit restores the
  // exact text it came from, so World -> Voxel -> World is not lossy (voxel
  // indices are rounded).
  const lastConversion = useRef<{ from: CoordInputs; to: CoordInputs } | null>(null);
  // Explains a switch that filled, cleared or refused fields (role=status).
  const [spaceNotice, setSpaceNotice] = useState<string | null>(null);
  const handleSpaceChange = (next: CoordSpace) => {
    if (next === space) return;
    const previous = lastConversion.current;
    if (previous && sameInputs(previous.to, inputs)) {
      setSpace(next);
      setSpaceNotice(null);
      lastConversion.current = { from: inputs, to: previous.from };
      setInputs(previous.from);
      return;
    }
    const affine = next === 'voxel' ? worldToVoxel : voxelToWorld;
    lastConversion.current = null;
    const invalid = {
      x: badInput.x || refusedPaste.x,
      y: badInput.y || refusedPaste.y,
      z: badInput.z || refusedPaste.z,
    };
    if (!affine) {
      // No transform: the numbers cannot be converted, so they are cleared
      // (never shown under the other unit). Switching straight back restores them.
      const cleared = { x: '', y: '', z: '' };
      setSpace(next);
      lastConversion.current = { from: inputs, to: cleared };
      setInputs(cleared);
      setSpaceNotice(null);
      return;
    }
    // The crosshair in the SOURCE space, for empty fields of an oblique affine.
    const fallback: [number, number, number] | null =
      space === 'world'
        ? [crosshair[0], crosshair[1], crosshair[2]]
        : worldToVoxel
          ? transformWorldToVoxelColumnMajor(worldToVoxel, [crosshair[0], crosshair[1], crosshair[2]])
          : null;
    const result = convertCoordInputs(inputs, affine, next, invalid, fallback);
    if (result.kind === 'blocked') {
      // An oblique affine mixes all three axes: an unparseable field would
      // leave the others meaningless. Stay in this space and say why.
      setSpaceNotice(
        `Fix ${result.axes.map(a => a.toUpperCase()).join(', ')} before switching the coordinate space.`,
      );
      return;
    }
    setSpace(next);
    setSpaceNotice(
      result.filled.length > 0
        ? `Empty ${result.filled.map(a => a.toUpperCase()).join(', ')} taken from the crosshair.`
        : null,
    );
    if (result.inputs) {
      lastConversion.current = { from: inputs, to: result.inputs };
      setInputs(result.inputs);
    }
  };

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

  /**
   * Outside the reference volume: world mm beyond its voxel-centre bounds, or
   * a voxel index outside [0, dim - 1]. A warning only: Go stays enabled and
   * nothing is clamped.
   */
  const isOutOfBounds = (axis: 'x' | 'y' | 'z'): boolean => {
    const val = parseNumericText(inputs[axis]);
    if (val === null) return false;
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    if (space === 'voxel') {
      const n = dims?.[idx];
      if (!n || !Number.isFinite(n)) return false;
      return val < 0 || val > n - 1;
    }
    if (!bounds) return false;
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
        // Voxel indices -> world mm through the named grid's affine. A voxel
        // of another layer's grid is an explicit target: not re-snapped to
        // the reference grid (which could land in a neighbouring voxel).
        if (!voxelToWorld) return;
        const target = transformVoxelToWorldColumnMajor(voxelToWorld, coords);
        if (grid?.isReference === false) {
          await setCrosshair(target, true, false, undefined, { snap: false });
        } else {
          await setCrosshair(target, true);
        }
      }
      onClose();
    } finally {
      setIsLoading(false);
    }
  }, [inputs, badInput, refusedPaste, space, setCrosshair, onClose, voxelToWorld, grid?.isReference]);

  const handleCurrent = useCallback(() => {
    if (space === 'world') {
      setInputs({
        x: crosshair[0].toFixed(1),
        y: crosshair[1].toFixed(1),
        z: crosshair[2].toFixed(1),
      });
    } else if (worldToVoxel) {
      // Nearest voxel of the crosshair on the named grid (`floor(v + 0.5)`,
      // the status bar's rule).
      const v = nearestVoxelIndex(
        transformWorldToVoxelColumnMajor(worldToVoxel, [crosshair[0], crosshair[1], crosshair[2]]),
      );
      setInputs({ x: String(v[0]), y: String(v[1]), z: String(v[2]) });
    }
  }, [crosshair, space, worldToVoxel]);

  const goDisabled = isLoading || voxelUnavailable || parseCoords() === null;

  // Enter submits only from the form's fields (implicit submission through
  // the Go submit button). Enter on a button activates that button: Cancel
  // cancels, Current fills, a space radio switches space.
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (goDisabled) return;
    void handleGo();
  };
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    if (!(e.target instanceof HTMLInputElement)) return;
    // Drive the submission explicitly so it does not depend on the
    // environment's implicit-submission support.
    e.preventDefault();
    if (goDisabled) return;
    const form = e.currentTarget;
    if (typeof form.requestSubmit === 'function') form.requestSubmit(goButtonRef.current ?? undefined);
    else void handleGo();
  };

  if (!open) return null;

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
      {/* No form name: the dialog already announces "Go to coordinate". */}
      <form noValidate onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
      <div className="px-5 py-4 space-y-4">
          {/* Space toggle: one joined segmented group, full width */}
          <SegmentedControl
            aria-label="Coordinate space"
            options={SPACE_OPTIONS}
            value={space}
            onValueChange={v => handleSpaceChange(v as CoordSpace)}
            fullWidth
          />

          {/* Coordinate inputs */}
          <div className="grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map(axis => {
              const bad = isUnparseable(axis);
              const oob = !bad && isOutOfBounds(axis);
              return (
                <FieldRow
                  key={axis}
                  label={axis.toUpperCase()}
                  controlId={`goto-${axis}`}
                  layout="stacked"
                  className="py-0"
                >
                  <NumberField
                    aria-label={`${axis.toUpperCase()} ${space === 'world' ? '(mm)' : '(voxel index)'}`}
                    // Out of bounds is allowed (warning, Go enabled): described
                    // by the warning, never marked invalid.
                    invalid={bad}
                    aria-describedby={bad ? 'goto-invalid' : oob ? 'goto-oob' : undefined}
                    fieldClassName={oob ? 'border-bf-warning hover:border-bf-warning' : undefined}
                    data-numeric-paste="self"
                    ref={axis === 'x' ? firstInputRef : undefined}
                    unit={space === 'world' ? 'mm' : 'vox'}
                    value={inputs[axis]}
                    onChange={e => {
                      const isBad = e.target.validity?.badInput === true;
                      setBadInput(prev => (prev[axis] === isBad ? prev : { ...prev, [axis]: isBad }));
                      setRefusedPaste(prev => (prev[axis] ? { ...prev, [axis]: false } : prev));
                      setInputs(prev => ({ ...prev, [axis]: e.target.value }));
                      setSpaceNotice(null);
                    }}
                    onPaste={handlePaste(axis)}
                    step={space === 'world' ? '0.1' : '1'}
                  />
                </FieldRow>
              );
            })}
          </div>

          {space === 'voxel' && grid && (
            <p className="text-bf-xs text-muted-foreground" data-testid="goto-grid">
              ijk on the grid of <span title={grid.name}>{grid.label}</span>
            </p>
          )}

          {(['x', 'y', 'z'] as const).some(a => isUnparseable(a)) && (
            <Notice id="goto-invalid" severity="danger" role="alert">
              {(['x', 'y', 'z'] as const)
                .filter(a => isUnparseable(a))
                .map(a => (refusedPaste[a] ? `Pasted ${a.toUpperCase()}` : a.toUpperCase()))
                .join(', ')}{' '}
              is not a number.
            </Notice>
          )}

          {/* Bounds warning */}
          {(['x', 'y', 'z'] as const).some(a => isOutOfBounds(a)) && (
            <Notice id="goto-oob" severity="warning" role="status">
              {space === 'voxel'
                ? 'Voxel index is outside the volume.'
                : 'Coordinate is outside volume bounds.'}
            </Notice>
          )}

          {spaceNotice && (
            <Notice severity="info" role="status">
              {spaceNotice}
            </Notice>
          )}

          {voxelUnavailable && (
            <Notice severity="warning" role="status">
              Voxel coordinates need a volume with a known voxel-to-world transform.
            </Notice>
          )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-bf-border-subtle px-5 py-3">
        <Button
          onClick={handleCurrent}
          variant="secondary"
          size="sm"
          disabled={space === 'voxel' && !worldToVoxel}
        >
          Current
        </Button>
        <div className="flex gap-2">
          <Button onClick={onClose} variant="secondary" size="sm">
            Cancel
          </Button>
          <Button ref={goButtonRef} type="submit" variant="primary" size="sm" disabled={goDisabled}>
            Go
          </Button>
        </div>
      </div>
      </form>
    </Modal>
  );
}

function sameInputs(a: CoordInputs, b: CoordInputs): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** World mm shown in a field: up to 3 decimals, trailing zeros trimmed, never "-0". */
function formatWorldInput(v: number): string {
  const r = Number(v.toFixed(3));
  return String(Object.is(r, -0) ? 0 : r);
}

/** Voxel index shown in a field: the nearest integer, never "-0". */
function formatVoxelInput(v: number): string {
  const r = Math.round(v);
  return String(Object.is(r, -0) ? 0 : r);
}

/** True when the affine's 3x3 part (column-major) has no off-diagonal terms. */
function isAxisAligned(m: number[]): boolean {
  return [1, 2, 4, 6, 8, 9].every(i => m[i] === 0);
}

type ConversionResult =
  | { kind: 'converted'; inputs: CoordInputs | null; filled: Array<'x' | 'y' | 'z'> }
  | { kind: 'blocked'; axes: Array<'x' | 'y' | 'z'> };

/**
 * Convert typed coordinates into the target space through `affine`
 * (column-major; either direction is the same 4x4 product).
 * - All three fields valid: a full transform.
 * - Axis-aligned affine: each valid field converts on its own; empty or
 *   invalid ones are left as typed.
 * - Oblique affine (every output mixes all inputs): EMPTY fields take the
 *   crosshair's value in the source space (`fallback`) and are reported in
 *   `filled`; all three outputs are then shown, so no number keeps its old
 *   meaning under the new unit. An UNPARSEABLE field blocks the switch.
 * `inputs` is null when nothing changes.
 */
function convertCoordInputs(
  inputs: CoordInputs,
  affine: number[],
  target: CoordSpace,
  invalid: Record<'x' | 'y' | 'z', boolean> = { x: false, y: false, z: false },
  fallback: readonly [number, number, number] | null = null,
): ConversionResult {
  const axes = ['x', 'y', 'z'] as const;
  const fmt = target === 'voxel' ? formatVoxelInput : formatWorldInput;
  const vals = axes.map(a => (invalid[a] ? null : parseNumericText(inputs[a])));
  const full = (v: readonly number[]): CoordInputs => {
    const out = transformVoxelToWorldColumnMajor(affine, v as [number, number, number]);
    return { x: fmt(out[0]), y: fmt(out[1]), z: fmt(out[2]) };
  };
  if (vals.every(v => v !== null)) {
    return { kind: 'converted', inputs: full(vals as number[]), filled: [] };
  }
  if (vals.every(v => v === null) && axes.every(a => !invalid[a] && inputs[a].trim() === '')) {
    return { kind: 'converted', inputs: null, filled: [] };
  }
  if (isAxisAligned(affine)) {
    const next = { ...inputs };
    vals.forEach((v, i) => {
      if (v === null) return;
      next[axes[i]] = fmt(affine[i * 5] * v + affine[12 + i]);
    });
    return { kind: 'converted', inputs: next, filled: [] };
  }
  const unparseable = axes.filter((a, i) => vals[i] === null && inputs[a].trim() !== '');
  const forcedInvalid = axes.filter(a => invalid[a]);
  const blocked = [...new Set([...unparseable, ...forcedInvalid])];
  if (blocked.length > 0 || !fallback) {
    return { kind: 'blocked', axes: blocked.length > 0 ? blocked : axes.filter((_, i) => vals[i] === null) };
  }
  const filled = axes.filter((_, i) => vals[i] === null);
  return { kind: 'converted', inputs: full(vals.map((v, i) => v ?? fallback[i])), filled };
}
