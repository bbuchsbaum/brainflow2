const NOT_FOUND = /No such file or directory|\(os error 2\)|cannot find the (?:file|path)/i;
const REMOTE_CACHE = /[\\/]remote_mounts[\\/]cache-/;
const LOAD_PATH = /Failed to load (?:member source |cohort member |cached cohort mean )?(.+?):\s/;

/**
 * A backend error about a set's image files, in plain words: a missing file
 * is said to be missing (with its name when the error carries one), and a
 * folder that is not connected is offered as a cause. Anything else is
 * returned as it is.
 *
 * `nameFor` turns the failing path into the name the user knows it by
 * ("sub-1014: same_item.nii.gz").
 */
export function plainStudioSourceError(
  message: string,
  nameFor?: (path: string) => string | null,
): string {
  if (!NOT_FOUND.test(message)) return message;
  const text = message;
  const path = LOAD_PATH.exec(text)?.[1]?.trim() ?? null;
  const name = path ? (nameFor?.(path) ?? path.split(/[\\/]/).filter(Boolean).pop() ?? null) : null;
  const remote = path ? REMOTE_CACHE.test(path) : REMOTE_CACHE.test(text);
  if (name)
    return remote
      ? `${name} has not been fetched from the remote folder.`
      : `${name} could not be found. It may have been moved or deleted.`;
  return 'An image file of this set could not be found. It may have been moved or deleted, or its remote folder is not connected.';
}
