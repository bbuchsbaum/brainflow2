/**
 * The one subset rule (A3): while a selection exists, what lies outside it
 * recedes but stays legible. One pairing, kept here:
 *
 * - Montage tiles: 0.6. A brain has fine structure; a selection of one must
 *   not make the other 34 unreadable. (Summary cutouts do not recede: they
 *   mark a selected cell by its outline alone.)
 * - Small marks (similarity-map points and their labels, Values dots and the
 *   legend's "others" swatch): 0.4. A 6 px mark at 0.6 is barely told apart
 *   from a selected one; at 0.4 it still reads against the panel.
 */
export const TILE_UNSELECTED_OPACITY = 0.6;
export const MARK_UNSELECTED_OPACITY = 0.4;
