/** Browser adapter for generated settings/images; never writes dataset contents. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Allow the navigation to consume the URL before releasing our reference.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
