import type { LayoutConfig } from 'golden-layout';

type ComparableValue =
  | null
  | boolean
  | number
  | string
  | undefined
  | ComparableValue[]
  | { [key: string]: ComparableValue };

function areComparableValuesEqual(a: ComparableValue, b: ComparableValue): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (a == null || b == null) {
    return a === b;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }

    for (let index = 0; index < a.length; index += 1) {
      if (!areComparableValuesEqual(a[index] as ComparableValue, b[index] as ComparableValue)) {
        return false;
      }
    }

    return true;
  }

  if (typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  const left = a as Record<string, ComparableValue>;
  const right = b as Record<string, ComparableValue>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!(key in right)) {
      return false;
    }

    if (!areComparableValuesEqual(left[key], right[key])) {
      return false;
    }
  }

  return true;
}

export function areLayoutConfigsEqual(
  left: LayoutConfig | null | undefined,
  right: LayoutConfig | null | undefined
): boolean {
  return areComparableValuesEqual(
    (left ?? null) as ComparableValue,
    (right ?? null) as ComparableValue
  );
}

export function cloneLayoutConfig<T extends LayoutConfig>(config: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(config);
  }

  return JSON.parse(JSON.stringify(config)) as T;
}
