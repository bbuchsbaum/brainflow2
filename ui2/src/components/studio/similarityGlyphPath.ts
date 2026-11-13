import type { SimilarityGlyphShape } from '@/services/studio/similarityGroupingView';

/** One group's mark, the same in the grid's headers, the legend and the map. */
export function glyphPath(shape: SimilarityGlyphShape, x: number, y: number, r: number): string {
  switch (shape) {
    case 'square':
      return `M${x - r},${y - r}h${2 * r}v${2 * r}h${-2 * r}z`;
    case 'triangle':
      return `M${x},${y - r * 1.15}L${x + r * 1.1},${y + r * 0.85}L${x - r * 1.1},${y + r * 0.85}z`;
    case 'triangle-down':
      return `M${x},${y + r * 1.15}L${x + r * 1.1},${y - r * 0.85}L${x - r * 1.1},${y - r * 0.85}z`;
    case 'cross':
      return `M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`;
    case 'plus':
      return `M${x - r},${y}h${2 * r}M${x},${y - r}v${2 * r}`;
    case 'diamond-hollow':
      return `M${x},${y - r * 1.25}L${x + r * 1.25},${y}L${x},${y + r * 1.25}L${x - r * 1.25},${y}z`;
    default:
      return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

/** Stroked-only marks: their outline is the mark. */
export const strokedGlyph = (shape: SimilarityGlyphShape) =>
  shape === 'cross' || shape === 'plus' || shape === 'diamond-hollow';

