import { getMockEmqStatuses } from '../../lib/api';
import type { EmqStatus } from '../../lib/api';

function EmqScoreGauge({ score }: { score: number | null }) {
  if (score === null) {
    return <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Neznáme</span>;
  }

  const pct = (score / 10) * 100;
  const color = score >= 7 ? 'var(--accent-green)' : score >= 5 ? 'var(--accent-yellow)' : 'var(--accent-red)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      {/* Circular gauge using SVG */}
      <svg width="52" height="52" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="20" fill="none" stroke="var(--bg-elevated)" strokeWidth="5" />
        <circle
          cx="26" cy="26" r="20" fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${(pct / 100) * 125.7} 125.7`}
          strokeLinecap="round"
          transform="rotate(-90 26 26)"
        />
        <text x="26" y="31" textAnchor="middle" fontSize="13" fontWeight="800" fill={color}>
          {score.toFixed(1)}
        </text>
      </svg>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
        / 10<br />EMQ skóre
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: EmqStatus['status'] }) {
  const map: Record<EmqStatus['status'], { cls: string; label: string }> = {
    ok: { cls: 'ok', label: '✓ OK' },
    warning: { cls: 'warning', label: '⚠ Nízke EMQ' },
    critical: { cls: 'critical', label: '✗ Kritické' },
    unknown: { cls: '', label: '? Neznáme' },
  };
  const { cls, label } = map[status];
  return cls ? (
    <span className={`alert-badge ${cls}`}>{label}</span>
  ) : (
    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
  );
}

function MatchRateBar({ rate }: { rate?: number }) {
  if (rate === undefined) return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>;
  const pct = rate * 100;
  const color = pct >= 80 ? 'var(--accent-green)' : pct >= 60 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '120px' }}>
      <div style={{ flex: 1, height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px' }} />
      </div>
      <span style={{ fontSize: '12px', fontWeight: 700, color, minWidth: '36px', fontFamily: 'var(--font-mono)' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'práve teraz';
  if (diff < 3600) return `pred ${Math.round(diff / 60)} min`;
  return `pred ${Math.round(diff / 3600)} h`;
}

export default async function CapiPage() {
  const statuses = getMockEmqStatuses();

  const avgEmq = statuses
    .filter((s) => s.emq_score !== null)
    .reduce((sum, s, _, arr) => sum + (s.emq_score ?? 0) / arr.length, 0);

  const warnings = statuses.filter((s) => s.status === 'warning' || s.status === 'critical');

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">CAPI Monitor</div>
          <div className="page-subtitle">
            Event Match Quality · Deduplikácia · SHA-256 PII hashovanie
          </div>
        </div>
        {warnings.length > 0 && (
          <span className="alert-badge warning">
            ⚠ {warnings.length} pixel{warnings.length > 1 ? 'y' : ''} vyžaduje pozornosť
          </span>
        )}
      </div>

      <div className="page-body">

        {/* Summary KPIs */}
        <div className="kpi-grid" style={{ marginBottom: '24px' }}>
          <div className="kpi-card">
            <div className="kpi-label">Priemerný EMQ</div>
            <div className="kpi-value" style={{ color: avgEmq >= 7 ? 'var(--accent-green)' : avgEmq >= 5 ? 'var(--accent-yellow)' : 'var(--accent-red)' }}>
              {avgEmq.toFixed(1)}/10
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Cieľ: ≥ 7.0 (Meta odporúčanie)
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Aktívne pixely</div>
            <div className="kpi-value">{statuses.filter((s) => s.status !== 'unknown').length}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              z {statuses.length} celkovo nakonfigurovaných
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Udalosti (24h)</div>
            <div className="kpi-value">
              {statuses.reduce((s, p) => s + p.events_received_24h, 0).toLocaleString('sk-SK')}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>celkovo cez všetky pixely</div>
          </div>
          <div className="kpi-card" style={{ '--kpi-accent': warnings.length > 0 ? 'var(--accent-red)' : 'var(--accent-green)' } as React.CSSProperties}>
            <div className="kpi-label">Stav</div>
            <div className="kpi-value" style={{ fontSize: '22px' }}>
              {warnings.length === 0 ? '✓ OK' : `⚠ ${warnings.length}`}
            </div>
            <div style={{ fontSize: '12px', color: warnings.length > 0 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 600 }}>
              {warnings.length === 0 ? 'Všetky pixely fungujú správne' : 'Pixely so zníženým EMQ'}
            </div>
          </div>
        </div>

        {/* Pixel Table */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <span className="card-title">Prehľad pixelov</span>
          </div>
          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Stav</th>
                  <th>Pixel</th>
                  <th>EMQ skóre</th>
                  <th>Match Rate</th>
                  <th>Udalosti (24h)</th>
                  <th>Naposledy kontrolovaný</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((s) => (
                  <tr key={s.pixel_id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`status-dot ${s.status === 'ok' ? 'green' : s.status === 'warning' ? 'yellow' : s.status === 'critical' ? 'red' : ''}`} />
                        <StatusChip status={s.status} />
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.pixel_name}</div>
                      <div className="mono">{s.pixel_id}</div>
                    </td>
                    <td>
                      <EmqScoreGauge score={s.emq_score} />
                    </td>
                    <td>
                      <MatchRateBar rate={s.match_rate} />
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {s.events_received_24h > 0 ? s.events_received_24h.toLocaleString('sk-SK') : '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {timeAgo(s.last_checked_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* EMQ Guide */}
        <div style={{ marginTop: '20px' }}>
          <div className="card">
            <div className="card-header" style={{ marginBottom: '16px' }}>
              <span className="card-title">Ako zlepšiť EMQ skóre</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              {[
                {
                  score: '9–10', color: 'var(--tier-elite)',
                  title: 'Maximálne EMQ',
                  tips: ['Email + telefón + meno', 'External ID zhodné s CRM', 'fbp + fbc cookies', 'IP adresa + User-Agent']
                },
                {
                  score: '7–8', color: 'var(--tier-strong)',
                  title: 'Dobré EMQ',
                  tips: ['Email alebo telefón', 'fbp cookie prítomná', 'External ID nastavené', 'Konzistentné event_id']
                },
                {
                  score: '<7', color: 'var(--tier-fixit)',
                  title: 'Nízke EMQ — vyžaduje opravu',
                  tips: ['Pridaj hashovanie emailu', 'Implementuj fbc z UTM', 'Skontroluj event_id dedup', 'Pridaj advanced matching']
                },
              ].map(({ score, color, title, tips }) => (
                <div key={score} style={{
                  padding: '14px 16px',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: `3px solid ${color}`
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '18px', fontWeight: 800, color }}>{score}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>{title}</span>
                  </div>
                  <ul style={{ paddingLeft: '16px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.8' }}>
                    {tips.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
