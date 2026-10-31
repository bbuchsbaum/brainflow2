/** Sentence-case message for parameters text that is not valid JSON, or null. */
export function parametersJsonError(text: string): string | null {
  if (text.trim().length === 0) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Not valid JSON: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`;
  }
}
