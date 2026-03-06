import { getMockCreatives } from '../../lib/api';
import type { CreativeTier } from '../../lib/api';

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="metric-bar-wrap">
      <div className="metric-bar">
        <div className="metric-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="metric-bar-value">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

function TierBadge({ tier }: { tier: CreativeTier }) {
  const labels: Record<CreativeTier, string> = {
    elite: '★ Elite',
    strong: '↑ Strong',
    average: '→ Average',
    'fix-it': '✗ Fix-it',
  };
  return <span className={`tier-badge ${tier}`}>{labels[tier]}</span>;
}

function TierLegend() {
  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px' }}>
      {[
        { tier: 'elite' as CreativeTier, desc: 'Hook ≥45% + Hold ≥50%' },
        { tier: 'strong' as CreativeTier, desc: 'Hook ≥30% + Hold ≥40%' },
        { tier: 'average' as CreativeTier, desc: 'Hook ≥20%' },
        { tier: 'fix-it' as CreativeTier, desc: 'Hook <20%' },
      ].map(({ tier, desc }) => (
        <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <TierBadge tier={tier} />
          <span style={{ color: 'var(--text-muted)' }}>{desc}</span>
        </div>
      ))}
    </div>
  );
}

export default async function CreativesPage() {
  const creatives = getMockCreatives();

  // Sumarizácia po tieroch
  const tierCounts = creatives.reduce(
    (acc, c) => { acc[c.performance_tier] = (acc[c.performance_tier] || 0) + 1; return acc; },
    {} as Record<CreativeTier, number>,
  );

  const totalSpend = creatives.reduce((s, c) => s + c.total_spend, 0);
  const eliteSpendShare = creatives
    .filter((c) => c.performance_tier === 'elite')
    .reduce((s, c) => s + c.total_spend, 0) / totalSpend;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Creative Intelligence</div>
          <div className="page-subtitle">Hook Rate · Hold Rate · Tier klasifikácia · Posledných 30 dní</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className="alert-badge ok">
            Elite škáluj: {tierCounts['elite'] ?? 0} kreatív
          </span>
          <span className="alert-badge warning">
            Fix-it pauzi: {tierCounts['fix-it'] ?? 0} kreatív
          </span>
        </div>
      </div>

      <div className="page-body">

        {/* Tier Overview Cards */}
        <div className="kpi-grid" style={{ marginBottom: '24px' }}>
          <div className="kpi-card" style={{ '--kpi-accent': 'var(--tier-elite)' } as React.CSSProperties}>
            <div className="kpi-label">Elite kreatívy</div>
            <div className="kpi-value">{tierCounts['elite'] ?? 0}</div>
            <div style={{ fontSize: '12px', color: 'var(--accent-green)', fontWeight: 600 }}>
              {(eliteSpendShare * 100).toFixed(0)}% z celkových výdavkov
            </div>
          </div>
          <div className="kpi-card" style={{ '--kpi-accent': 'var(--tier-strong)' } as React.CSSProperties}>
            <div className="kpi-label">Strong kreatívy</div>
            <div className="kpi-value">{tierCounts['strong'] ?? 0}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Optimálne pre škálovanie</div>
          </div>
          <div className="kpi-card" style={{ '--kpi-accent': 'var(--tier-average)' } as React.CSSProperties}>
            <div className="kpi-label">Average kreatívy</div>
            <div className="kpi-value">{tierCounts['average'] ?? 0}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Testuj hook/CTA</div>
          </div>
          <div className="kpi-card" style={{ '--kpi-accent': 'var(--tier-fixit)' } as React.CSSProperties}>
            <div className="kpi-label">Fix-it kreatívy</div>
            <div className="kpi-value">{tierCounts['fix-it'] ?? 0}</div>
            <div style={{ fontSize: '12px', color: 'var(--accent-red)', fontWeight: 600 }}>
              Pozastav alebo nahraď
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="card" style={{ marginBottom: '20px', padding: '14px 20px' }}>
          <TierLegend />
        </div>

        {/* Creatives Table */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">Všetky kreatívy</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {creatives.length} kreatív · zoradené podľa výdavkov
            </span>
          </div>

          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Kreatíva</th>
                  <th>Hook Rate</th>
                  <th>Hold Rate</th>
                  <th>ROAS</th>
                  <th>CPA</th>
                  <th>Výdavky</th>
                  <th>Konverzie</th>
                  <th>Impresie</th>
                </tr>
              </thead>
              <tbody>
                {creatives
                  .sort((a, b) => b.total_spend - a.total_spend)
                  .map((c) => (
                    <tr key={c.creative_id}>
                      <td><TierBadge tier={c.performance_tier} /></td>
                      <td>
                        <div style={{ fontWeight: 500, maxWidth: '220px' }}>{c.ad_name ?? c.creative_id}</div>
                        <div className="mono">{c.creative_id}</div>
                      </td>
                      <td style={{ minWidth: '140px' }}>
                        <MetricBar value={c.hook_rate} max={0.6} color={
                          c.hook_rate >= 0.45 ? 'var(--tier-elite)' :
                          c.hook_rate >= 0.30 ? 'var(--tier-strong)' :
                          c.hook_rate >= 0.20 ? 'var(--tier-average)' : 'var(--tier-fixit)'
                        } />
                      </td>
                      <td style={{ minWidth: '140px' }}>
                        <MetricBar value={c.hold_rate} max={0.7} color={
                          c.hold_rate >= 0.50 ? 'var(--tier-elite)' :
                          c.hold_rate >= 0.40 ? 'var(--tier-strong)' :
                          c.hold_rate >= 0.30 ? 'var(--tier-average)' : 'var(--tier-fixit)'
                        } />
                      </td>
                      <td style={{ fontWeight: 700, color: c.roas >= 4 ? 'var(--accent-green)' : c.roas >= 2.5 ? 'var(--text-primary)' : 'var(--accent-red)' }}>
                        {c.roas.toFixed(2)}x
                      </td>
                      <td className="mono">€{c.cpa.toFixed(1)}</td>
                      <td className="mono" style={{ fontWeight: 600 }}>€{c.total_spend.toLocaleString('sk-SK')}</td>
                      <td className="mono">{c.total_conversions.toLocaleString('sk-SK')}</td>
                      <td className="mono" style={{ color: 'var(--text-secondary)' }}>
                        {(c.total_impressions / 1000).toFixed(0)}k
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Insight Callout */}
        <div style={{ marginTop: '16px', padding: '14px 18px', background: 'var(--accent-blue-dim)', border: '1px solid rgba(91,124,246,0.3)', borderRadius: 'var(--radius-md)', fontSize: '13px', lineHeight: '1.6' }}>
          <strong style={{ color: 'var(--accent-blue)' }}>💡 Odporúčanie:</strong>{' '}
          Elite kreatívy generujú <strong>{(eliteSpendShare * 100).toFixed(0)}%</strong> výdavkov.
          Zvýš rozpočet Elite kreatívam o 20–30% a pozastav Fix-it kreatívy —
          tým zvýšiš celkový ROAS bez navýšenia celkového rozpočtu.
        </div>
      </div>
    </>
  );
}
