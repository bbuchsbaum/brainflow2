/**
 * The surface pane's orientation glyph (phase 4, D5): R / A / S axes as the
 * camera sees them. Achromatic chrome (the frame's text tokens); the axis
 * pointing at the viewer is drawn last.
 */
import { END_ON, projectGizmoAxes, type CameraBasis } from '@/utils/orientationGizmo';

export function OrientationGizmo({ basis, size = 64 }: { basis: CameraBasis; size?: number }) {
  const c = size / 2;
  const r = size * 0.32;
  const axes = projectGizmoAxes(basis);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Orientation: ${axes
        .slice()
        .sort((a, b) => b.depth - a.depth)
        .map((a) => a.label)
        .join(', ')}, nearest first`}
      data-testid="surface-orientation-gizmo"
      className="text-bf-text-secondary"
    >
      {axes.map((axis) => {
        const x = c + axis.x * r;
        const y = c + axis.y * r;
        const away = axis.depth < -0.05;
        if (Math.hypot(axis.x, axis.y) < END_ON) {
          // Along the line of sight: a ring (away) or a dot (toward), the
          // letter beside it.
          return (
            <g key={axis.label}>
              <circle
                cx={c}
                cy={c}
                r={3}
                fill={away ? 'none' : 'currentColor'}
                stroke="currentColor"
                strokeWidth={1.25}
              />
              <text
                x={c + 7}
                y={c + 8}
                fill="currentColor"
                fontSize={11}
                fontFamily="var(--bf-font-sans, sans-serif)"
                dominantBaseline="central"
              >
                {axis.label}
              </text>
            </g>
          );
        }
        return (
          <g key={axis.label} opacity={away ? 0.55 : 1}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            <text
              x={c + axis.x * (r + 8)}
              y={c + axis.y * (r + 8)}
              fill="currentColor"
              fontSize={11}
              fontFamily="var(--bf-font-sans, sans-serif)"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {axis.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
