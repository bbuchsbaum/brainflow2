/** Portable source identity. Names are hints for reselection, never identity. */
export interface SessionSource {
  name: string;
  size: number;
  sha256: string;
}

export const MAX_SESSION_SOURCE_BYTES = 256 * 1024 * 1024;

/** Run in the worker, one file at a time; no retained byte cache. */
export async function describeSessionSource(
  file: File,
  cancelled: () => boolean = () => false,
): Promise<SessionSource> {
  const check = () => {
    if (cancelled()) throw new DOMException('Operation cancelled', 'AbortError');
  };
  check();
  if (!(file instanceof File) || file.size > MAX_SESSION_SOURCE_BYTES)
    throw new Error('Select a session source no larger than 256 MiB.');
  const bytes = await file.arrayBuffer();
  check();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  check();
  return {
    name: file.name,
    size: file.size,
    sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    ),
  };
}

export function isSessionSource(value: unknown): value is SessionSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<SessionSource>;
  return (
    typeof source.name === 'string' &&
    source.name.length > 0 &&
    typeof source.size === 'number' &&
    Number.isSafeInteger(source.size) &&
    source.size >= 0 &&
    source.size <= MAX_SESSION_SOURCE_BYTES &&
    typeof source.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(source.sha256)
  );
}

/** Resolve all sources before changing a workspace. Duplicate content may share a file. */
export function matchSessionSources(
  required: readonly SessionSource[],
  selected: readonly { file: File; source: SessionSource }[],
): File[] {
  if (!required.every(isSessionSource) || !selected.every(({ source }) => isSessionSource(source)))
    throw new Error('Invalid session source identity.');
  return required.map((source) => {
    const match = selected.find(
      (candidate) =>
        candidate.source.size === source.size && candidate.source.sha256 === source.sha256,
    );
    if (!match) throw new Error(`Reselect the original contents of “${source.name}”.`);
    return match.file;
  });
}
