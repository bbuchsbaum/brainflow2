/**
 * Public surface of the grammar-of-graphics-lite plotting layer.
 *
 * Import from `@/plotting` rather than the individual modules so the internal
 * file layout can evolve as steps 2–4 land (generic encoder, role-based
 * default inference, design-table join).
 */

export * from "./types";
export * from "./frame";
export * from "./spec";
export * from "./join";
export * from "./transforms";
