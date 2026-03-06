'use client';

// ============================================================
// ComparisonChart — SVG bar chart, 2 série (aktuálne vs. predošlé)
// Pure SVG, žiadna externá knižnica
// ============================================================

interface ChartSeries {
  label: string;
  values: number[];
  color: string;
}

interface ComparisonChartProps {
  categories: string[];
  series: [ChartSeries, ChartSeries]; // vždy 2 série
  height?: number;
  yFormatter?: (v: number) => string;
}

const PAD = { top: 20, right: 16, bottom: 44, left: 52 };
const VIEWBOX_W = 620;

export function ComparisonChart({
  categories,
  series,
  height = 220,
  yFormatter,
}: ComparisonChartProps) {
  const W = VIEWBOX_W;
  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const allVals = series.flatMap((s) => s.values);
  const maxVal = Math.max(...allVals, 0.001) * 1.12;

  const nCats = categories.length;
  const groupW = plotW / nCats;
  const barsTotal = groupW * 0.68;
  const barW = barsTotal / 2;
  const groupPad = (groupW - barsTotal) / 2;

  const toY = (v: number) => plotH - (v / maxVal) * plotH;
  const fmt = yFormatter ?? ((v: number) => v.toFixed(1));

  // Y ticks — 5 rovnomerných
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const frac = i / 4;
    return { y: plotH - frac * plotH, val: maxVal * frac };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: `${H}px`, display: 'block' }}
    >
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {/* Grid + Y-osi */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={0} y1={t.y} x2={plotW} y2={t.y}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={1}
            />
            <text
              x={-7} y={t.y + 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {fmt(t.val)}
            </text>
          </g>
        ))}

        {/* Stĺpce */}
        {categories.map((cat, ci) => {
          const gx = ci * groupW + groupPad;
          return series.map((s, si) => {
            const v = s.values[ci] ?? 0;
            const bh = Math.max(1, (v / maxVal) * plotH);
            const bx = gx + si * barW;
            const by = toY(v);
            const isCurrentPeriod = si === 0;
            return (
              <g key={`${ci}-${si}`}>
                <rect
                  x={bx}
                  y={by}
                  width={barW - 2}
                  height={bh}
                  fill={s.color}
                  rx={3}
                  opacity={isCurrentPeriod ? 0.95 : 0.38}
                />
                {bh > 18 && (
                  <text
                    x={bx + (barW - 2) / 2}
                    y={by + 12}
                    textAnchor="middle"
                    fontSize={9}
                    fill="rgba(255,255,255,0.85)"
                    fontWeight={600}
                  >
                    {fmt(v)}
                  </text>
                )}
              </g>
            );
          });
        })}

        {/* X-os */}
        <line x1={0} y1={plotH} x2={plotW} y2={plotH} stroke="var(--border)" strokeWidth={1} />

        {/* X-labely */}
        {categories.map((cat, ci) => (
          <text
            key={ci}
            x={ci * groupW + groupW / 2}
            y={plotH + 16}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-secondary)"
          >
            {cat}
          </text>
        ))}
      </g>

      {/* Legenda vpravo hore */}
      <g transform={`translate(${W - 148}, 10)`}>
        {series.map((s, i) => (
          <g key={i} transform={`translate(0, ${i * 18})`}>
            <rect x={0} y={2} width={10} height={10} fill={s.color} rx={2} opacity={i === 0 ? 0.95 : 0.38} />
            <text x={14} y={11} fontSize={10} fill="var(--text-secondary)">
              {s.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
