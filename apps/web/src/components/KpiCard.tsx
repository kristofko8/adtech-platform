interface KpiCardProps {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  accentColor?: string;
}

export function KpiCard({ label, value, change, changeLabel, accentColor = 'var(--accent-blue)' }: KpiCardProps) {
  const changeDir = change === undefined ? 'neutral' : change >= 0 ? 'positive' : 'negative';
  const arrow = change === undefined ? '' : change >= 0 ? '▲' : '▼';

  return (
    <div className="kpi-card" style={{ '--kpi-accent': accentColor } as React.CSSProperties}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {change !== undefined && (
        <div className={`kpi-change ${changeDir}`}>
          <span>{arrow}</span>
          <span>{Math.abs(change).toFixed(1)}%</span>
          {changeLabel && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{changeLabel}</span>}
        </div>
      )}
    </div>
  );
}
