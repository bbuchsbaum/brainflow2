/**
 * Numeric entry that survives the product's own display glyphs.
 *
 * Readouts show negatives with the true minus sign (U+2212, see
 * `valueFormat.ts`). An `<input type="number">` rejects that character: in
 * Chromium (Tauri on Windows / WebView2) it silently keeps the digits, so
 * pasting the status bar's "−37.5" would yield +37.5; in WebKit the value
 * becomes empty. Both are wrong for coordinates and thresholds.
 *
 * Choice: keep `type="number"` (native ArrowUp/Down stepping, spinner,
 * numeric keypad, `validity.badInput`, every existing behaviour of the 19
 * numeric fields) and normalise what goes INTO the field before the browser
 * sanitises it, with one document-level guard (`installNumericInputGuard`,
 * installed at app start) for:
 *   - `paste` (and drop): minus-like dashes → ASCII "-", surrounding
 *     whitespace trimmed; a paste that is still not a number is refused and
 *     the field is marked invalid instead of letting the browser strip it to
 *     some other number;
 *   - `beforeinput` (typing, IME, drop): a typed minus-like dash becomes "-".
 * A guard on the document covers every numeric field, including those added
 * later, without changing their markup. Fields that parse their own text use
 * `parseNumericText`, which applies the same normalisation and is strict.
 */
import { asciiMinus, MINUS_LIKE } from './valueFormat';

/** Strict decimal / scientific number (what a number input accepts). */
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Minus-like dashes → ASCII "-", trimmed. */
export function normalizeNumericText(text: string): string {
  return asciiMinus(text).trim();
}

/**
 * Several numbers in one pasted string, e.g. the status bar's crosshair
 * "(−37.5, −18.5, 17.5)" or "-37.5 -18.5 17.5". Null unless every token is a
 * number.
 */
export function parseNumericList(text: string): number[] | null {
  const tokens = asciiMinus(text)
    .replace(/[()[\]{}]/g, ' ')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const values = tokens.map(parseNumericText);
  return values.every((v): v is number => v !== null) ? (values as number[]) : null;
}

/**
 * Parse typed or pasted numeric text: dashes normalised, then the WHOLE text
 * must be a number ("−37.5" → -37.5, "37.5 mm" → null, "" → null). Never
 * returns a number with a sign or digits silently dropped.
 */
export function parseNumericText(text: string): number | null {
  const normalized = normalizeNumericText(text);
  if (!NUMBER_RE.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Fields the guard handles: number inputs and opted-in decimal text fields. */
export function isNumericField(target: EventTarget | null): target is HTMLInputElement {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLInputElement;
  if (el.tagName !== 'INPUT') return false;
  return el.type === 'number' || el.dataset?.numeric === 'true';
}

/** Attribute set on a field whose pasted text was refused as not a number. */
export const NUMERIC_INVALID_ATTR = 'data-numeric-invalid';

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Insert `text` at the caret through the editing pipeline (keeps undo and
 * fires a real `input` event React sees). Where `execCommand` is unavailable
 * (jsdom), the field's value is replaced.
 */
function insertText(input: HTMLInputElement, text: string): void {
  const doc = input.ownerDocument;
  let inserted = false;
  try {
    if (doc.activeElement !== input) input.focus();
    inserted = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) setNativeValue(input, text);
}

function markInvalid(input: HTMLInputElement, text: string): void {
  input.setAttribute(NUMERIC_INVALID_ATTR, 'true');
  // Only own aria-invalid when the field's component does not set it.
  if (!input.hasAttribute('aria-invalid')) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('data-numeric-aria', 'true');
  }
  const message = `"${text}" is not a number`;
  try {
    input.setCustomValidity(message);
    input.reportValidity?.();
  } catch {
    /* reportValidity is best effort */
  }
}

function clearInvalid(input: HTMLInputElement): void {
  if (!input.hasAttribute(NUMERIC_INVALID_ATTR)) return;
  input.removeAttribute(NUMERIC_INVALID_ATTR);
  if (input.hasAttribute('data-numeric-aria')) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('data-numeric-aria');
  }
  try {
    input.setCustomValidity('');
  } catch {
    /* noop */
  }
}

/**
 * Handle text arriving by paste or drop. Returns true when the event was
 * taken over (default prevented).
 */
export function handleNumericPasteText(
  input: HTMLInputElement,
  raw: string,
  event: Event,
): boolean {
  const normalized = normalizeNumericText(raw);
  if (NUMBER_RE.test(normalized)) {
    // Even ASCII text goes through here so surrounding whitespace never
    // makes the browser drop the value.
    if (normalized === raw) return false;
    event.preventDefault();
    clearInvalid(input);
    insertText(input, normalized);
    return true;
  }
  // Not a number even after normalisation: refuse it visibly rather than let
  // the browser strip characters down to a different number.
  event.preventDefault();
  markInvalid(input, raw.trim());
  return true;
}

/** A field that handles its own paste (`data-numeric-paste="self"`). */
function handlesOwnPaste(input: HTMLInputElement): boolean {
  return input.dataset?.numericPaste === 'self';
}

function onPaste(event: ClipboardEvent): void {
  if (!isNumericField(event.target) || handlesOwnPaste(event.target)) return;
  const raw = event.clipboardData?.getData('text/plain') ?? '';
  if (!raw) return;
  handleNumericPasteText(event.target, raw, event);
}

function onDrop(event: DragEvent): void {
  if (!isNumericField(event.target) || handlesOwnPaste(event.target)) return;
  const raw = event.dataTransfer?.getData('text/plain') ?? '';
  if (!raw) return;
  handleNumericPasteText(event.target, raw, event);
}

function onBeforeInput(event: InputEvent): void {
  if (!isNumericField(event.target)) return;
  const input = event.target;
  if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
    // Already handled by the paste / drop listeners when they fired.
    return;
  }
  const data = event.data;
  if (!data) return;
  MINUS_LIKE.lastIndex = 0;
  if (!MINUS_LIKE.test(data)) return;
  MINUS_LIKE.lastIndex = 0;
  event.preventDefault();
  insertText(input, asciiMinus(data));
}

function onInput(event: Event): void {
  if (isNumericField(event.target)) clearInvalid(event.target);
}

/**
 * Install the guard on a document (capture phase, so it runs before any
 * field handler). Returns the uninstaller. Idempotent per document.
 */
export function installNumericInputGuard(doc: Document = document): () => void {
  const marker = doc as Document & { __bfNumericGuard?: () => void };
  if (marker.__bfNumericGuard) return marker.__bfNumericGuard;
  doc.addEventListener('paste', onPaste, true);
  doc.addEventListener('drop', onDrop, true);
  doc.addEventListener('beforeinput', onBeforeInput as EventListener, true);
  doc.addEventListener('input', onInput, true);
  const uninstall = () => {
    doc.removeEventListener('paste', onPaste, true);
    doc.removeEventListener('drop', onDrop, true);
    doc.removeEventListener('beforeinput', onBeforeInput as EventListener, true);
    doc.removeEventListener('input', onInput, true);
    delete marker.__bfNumericGuard;
  };
  marker.__bfNumericGuard = uninstall;
  return uninstall;
}

/**
 * `onCopy` handler for readouts that display U+2212: the clipboard gets the
 * ASCII text, so a copied value pastes as a number anywhere (this app's
 * fields, R, Python, a spreadsheet). Only rewrites when the selection holds
 * a minus-like dash.
 */
export function asciiCopyHandler(event: {
  clipboardData: DataTransfer | null;
  preventDefault: () => void;
}): void {
  const selection =
    typeof window !== 'undefined' ? (window.getSelection?.()?.toString() ?? '') : '';
  if (!selection || !event.clipboardData) return;
  MINUS_LIKE.lastIndex = 0;
  if (!MINUS_LIKE.test(selection)) return;
  MINUS_LIKE.lastIndex = 0;
  event.clipboardData.setData('text/plain', asciiMinus(selection));
  event.preventDefault();
}
