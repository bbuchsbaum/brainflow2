/**
 * A pane reason for people: cache and file paths are dropped ("… cache hit
 * at /var/…/cohort-mean:….nii.gz." reads "… cache hit."; QA F8).
 */
export function paneReasonText(reason: string | null): string | null {
  if (!reason) return null;
  const text = reason
    .replace(/\s+(?:at|in|from)\s+(?:[A-Za-z]:)?[\\/]\S*?(?=\.?(?:\s|$))/g, '')
    .replace(/(?:[A-Za-z]:)?[\\/](?:[^\s\\/]+[\\/])+([^\s\\/]+?)(?=\.?(?:\s|$))/g, '$1')
    .trim();
  return text || null;
}
