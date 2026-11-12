import type { SimilarityGlyphShape } from '@/services/studio/similarityGroupingView';
import { glyphPath, strokedGlyph } from './similarityGlyphPath';

export function SimilarityGlyph({
  shape,
  size = 10,
  className,
}: {
  shape: SimilarityGlyphShape;
  size?: number;
  className?: string;
}) {
  const stroked = strokedGlyph(shape);
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={className ?? 'shrink-0'}
      data-glyph={shape}
    >
      <path
        d={glyphPath(shape, 5, 5, 3.4)}
        fill={stroked ? 'none' : 'var(--bf-text-secondary)'}
        stroke="var(--bf-text-secondary)"
        strokeWidth={stroked ? 1.3 : 0}
      />
    </svg>
  );
}
