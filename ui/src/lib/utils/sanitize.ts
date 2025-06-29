/**
 * Sanitization utilities for security
 * Prevents XSS and path traversal attacks
 */

/**
 * Sanitize file paths to prevent directory traversal
 */
export function sanitizePath(path: string): string {
  // Remove any .. sequences
  if (path.includes('..')) {
    throw new Error('Path traversal attempt detected');
  }
  
  // Normalize path (remove duplicate slashes, etc)
  const normalized = path
    .split('/')
    .filter(Boolean)
    .join('/');
  
  // Ensure absolute path
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * Sanitize file names for display
 * Escapes HTML entities to prevent XSS
 */
export function sanitizeFileName(name: string): string {
  const entityMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };
  
  return String(name).replace(/[&<>"'\/]/g, (s) => entityMap[s]);
}

/**
 * Validate and sanitize mount paths
 */
export function sanitizeMountPath(path: string): string {
  // Must be absolute
  if (!path.startsWith('/')) {
    throw new Error('Mount path must be absolute');
  }
  
  // Cannot contain special sequences
  const forbidden = ['..', '~', '$', '`', '|', ';', '&'];
  for (const seq of forbidden) {
    if (path.includes(seq)) {
      throw new Error(`Mount path contains forbidden sequence: ${seq}`);
    }
  }
  
  return sanitizePath(path);
}

/**
 * Create safe HTML from text
 * Use this instead of {@html} when displaying user content
 */
export function createSafeHtml(text: string): string {
  return sanitizeFileName(text);
}

/**
 * Validate resource IDs (UUIDs, handles, etc)
 */
export function sanitizeResourceId(id: string): string {
  // Only allow alphanumeric, dash, and underscore
  const cleaned = id.replace(/[^a-zA-Z0-9\-_]/g, '');
  
  if (cleaned !== id) {
    throw new Error('Invalid resource ID');
  }
  
  return cleaned;
}

/**
 * Sanitize user input for commands
 */
export function sanitizeCommandInput(input: string): string {
  // Remove any shell metacharacters
  const dangerous = /[;&|`$(){}[\]<>\\]/g;
  return input.replace(dangerous, '');
}