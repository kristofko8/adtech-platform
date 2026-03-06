'use client';

import type { SpendDataPoint } from '../lib/api';

interface SparklineChartProps {
  data: SpendDataPoint[];
  metric?: 'spend' | 'roas' | 'revenue';
  height?: number;
}

export function SparklineChart({ data, metric = 'spend', height = 120 }: SparklineChartProps) {
  if (!data.length) return null;

  const values = data.map((d) => d[metric]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const W = 600;
  const H = height;
  const PAD = 20;
  const w = W - PAD * 2;
  const h = H - PAD;

  const toX = (i: number) => PAD + (i / (data.length - 1)) * w;
  const toY = (v: number) => H - PAD - ((v - min) / range) * h;

  const pathD = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d[metric]).toFixed(1)}`)
    .join(' ');

  const areaD = `${pathD} L ${toX(data.length - 1).toFixed(1)} ${H} L ${toX(0).toFixed(1)} ${H} Z`;

  // Last 7 days average vs previous 7 days for trend
  const last7 = values.slice(-7);
  const prev7 = values.slice(-14, -7);
  const last7Avg = last7.reduce((s, v) => s + v, 0) / (last7.length || 1);
  const prev7Avg = prev7.length ? prev7.reduce((s, v) => s + v, 0) / prev7.length : last7Avg;
  const trendPct = ((last7Avg - prev7Avg) / (prev7Avg || 1)) * 100;
  const trendColor = metric === 'roas' || metric === 'revenue'
    ? trendPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'
    : trendPct >= 0 ? 'var(--accent-red)' : 'var(--accent-green)'; // spend: lower is better only if not revenue-driven

  const accentColor = metric === 'roas' ? 'var(--accent-purple)' :
                      metric === 'revenue' ? 'var(--accent-green)' : 'var(--accent-blue)';

  const labelMap = { spend: 'Výdavky', roas: 'ROAS', revenue: 'Príjmy' };
  const formatVal = (v: number) =>
    metric === 'roas' ? v.toFixed(2) + 'x' : '€' + v.toLocaleString('sk');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
          {labelMap[metric]}
        </span>
        <span style={{ fontSize: '12px', fontWeight: 700, color: trendColor }}>
          {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct).toFixed(1)}% vs. predchádzajúci týždeň
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }}>
        <defs>
          <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path d={areaD} fill={`url(#grad-${metric})`} />

        {/* Line */}
        <path d={pathD} fill="none" stroke={accentColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points (every 5th) */}
        {data.map((d, i) => i % 5 === 0 && (
          <g key={i}>
            <circle cx={toX(i)} cy={toY(d[metric])} r="3" fill={accentColor} />
            <title>{d.date}: {formatVal(d[metric])}</title>
          </g>
        ))}

        {/* Last point highlighted */}
        <circle
          cx={toX(data.length - 1)}
          cy={toY(values[values.length - 1])}
          r="4"
          fill={accentColor}
          stroke="var(--bg-surface)"
          strokeWidth="2"
        />

        {/* X axis labels */}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text
            key={i}
            x={toX(i)}
            y={H}
            textAnchor="middle"
            fontSize="10"
            fill="var(--text-muted)"
          >
            {data[i]?.date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}
