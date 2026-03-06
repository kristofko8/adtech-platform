import { KpiCard } from '../components/KpiCard';
import { SparklineChart } from '../components/SparklineChart';
import { getMockKpis, getMockTimeSeries, getMockAnomalies } from '../lib/api';
import type { AnomalyRecord } from '../lib/api';

// Formátovanie hodnôt
function fmt(v: number, type: 'currency' | 'pct' | 'roas' | 'number' = 'number'): string {
  if (type === 'currency') return '€' + v.toLocaleString('sk-SK', { maximumFractionDigits: 0 });
  if (type === 'pct') return v.toFixed(2) + '%';
  if (type === 'roas') return v.toFixed(2) + 'x';
  return v.toLocaleString('sk-SK');
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'práve teraz';
  if (diff < 3600) return `pred ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `pred ${Math.round(diff / 3600)} h`;
  return `pred ${Math.round(diff / 86400)} d`;
}

function ZScoreBar({ zScore }: { zScore: number }) {
  const abs = Math.min(Math.abs(zScore), 10);
  const pct = (abs / 10) * 100;
  const color = abs >= 3 ? 'var(--accent-red)' : abs >= 2 ? 'var(--accent-yellow)' : 'var(--accent-green)';
  return (
    <div className="metric-bar-wrap">
      <div className="metric-bar">
        <div className="metric-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="metric-bar-value" style={{ color }}>{zScore > 0 ? '+' : ''}{zScore.toFixed(2)}σ</span>
    </div>
  );
}

export default async function DashboardPage() {
  // V produkcii: await getAccountKpis(accountId, dateFrom, dateTo)
  const kpis = getMockKpis();
  const timeSeries = getMockTimeSeries();
  const anomalies = getMockAnomalies();
  const criticalCount = anomalies.filter((a: AnomalyRecord) => a.severity === 'CRITICAL').length;

  const today = new Date().toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Posledných 30 dní · {today}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {criticalCount > 0 && (
            <span className="alert-badge critical">
              ⚠ {criticalCount} kritické anomálie
            </span>
          )}
          <a href="/creatives" className="btn btn-primary">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
            </svg>
            Creative Intelligence
          </a>
        </div>
      </div>

      <div className="page-body">
        {/* KPI Grid */}
        <div className="kpi-grid">
          <KpiCard
            label="Celkové výdavky"
            value={fmt(kpis.totalSpend, 'currency')}
            change={12.4}
            changeLabel="vs. minulý mesiac"
            accentColor="var(--accent-blue)"
          />
          <KpiCard
            label="Celkové príjmy"
            value={fmt(kpis.totalRevenue, 'currency')}
            change={18.2}
            changeLabel="vs. minulý mesiac"
            accentColor="var(--accent-green)"
          />
          <KpiCard
            label="ROAS"
            value={fmt(kpis.roas, 'roas')}
            change={4.8}
            changeLabel="vs. minulý mesiac"
            accentColor="var(--accent-purple)"
          />
          <KpiCard
            label="CPA"
            value={fmt(kpis.cpa, 'currency')}
            change={-8.1}
            changeLabel="vs. minulý mesiac"
            accentColor="var(--accent-yellow)"
          />
          <KpiCard
            label="Impresie"
            value={fmt(kpis.totalImpressions)}
            change={22.7}
            accentColor="var(--accent-blue)"
          />
          <KpiCard
            label="CTR"
            value={fmt(kpis.ctr, 'pct')}
            change={-1.2}
            accentColor="var(--accent-red)"
          />
        </div>

        {/* Charts Row */}
        <div className="grid-2" style={{ marginBottom: '24px' }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Výdavky — 30 dní</span>
            </div>
            <SparklineChart data={timeSeries} metric="spend" height={130} />
          </div>
          <div className="card">
            <div className="card-header">
              <span className="card-title">ROAS — 30 dní</span>
            </div>
            <SparklineChart data={timeSeries} metric="roas" height={130} />
          </div>
        </div>

        {/* Anomaly Log */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Posledné anomálie</span>
            <a href="/anomalies" className="btn btn-ghost" style={{ fontSize: '12px', padding: '4px 10px' }}>
              Zobraziť všetky →
            </a>
          </div>

          {anomalies.length === 0 ? (
            <div className="empty-state">
              <h3>Žiadne anomálie</h3>
              <p>Všetky kampane sú v norme.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Závažnosť</th>
                    <th>Kampaň</th>
                    <th>Metrika</th>
                    <th>Aktuálna hodnota</th>
                    <th>Priemer (21d)</th>
                    <th>Z-skóre</th>
                    <th>Čas</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((a, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`alert-badge ${a.severity === 'CRITICAL' ? 'critical' : 'warning'}`}>
                          {a.severity === 'CRITICAL' ? '🔴 Kritické' : '🟡 Varovanie'}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{a.campaign_name ?? `Campaign ${a.campaign_id}`}</div>
                        <div className="mono">{a.campaign_id}</div>
                      </td>
                      <td style={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)' }}>
                        {a.metric}
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        {a.metric === 'spend' ? fmt(a.current_value, 'currency') :
                         a.metric === 'roas' ? fmt(a.current_value, 'roas') :
                         a.metric === 'ctr' ? fmt(a.current_value, 'pct') :
                         fmt(a.current_value, 'currency')}
                      </td>
                      <td className="mono" style={{ color: 'var(--text-secondary)' }}>
                        {a.baseline_mean.toFixed(1)} ± {a.baseline_std.toFixed(1)}
                      </td>
                      <td style={{ minWidth: '160px' }}>
                        <ZScoreBar zScore={a.z_score} />
                      </td>
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {timeAgo(a.detected_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
