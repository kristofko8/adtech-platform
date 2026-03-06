import { getMockAnomalies } from '../../lib/api';
import type { AnomalyRecord } from '../../lib/api';

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'práve teraz';
  if (diff < 3600) return `pred ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `pred ${Math.round(diff / 3600)} h`;
  return `pred ${Math.round(diff / 86400)} d`;
}

function ZScoreGauge({ z }: { z: number }) {
  const abs = Math.abs(z);
  const pct = Math.min((abs / 10) * 100, 100);
  const color = abs >= 3 ? 'var(--accent-red)' : abs >= 2 ? 'var(--accent-yellow)' : 'var(--accent-green)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '8px', background: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color, fontWeight: 700, minWidth: '52px', textAlign: 'right' }}>
        {z > 0 ? '+' : ''}{z.toFixed(2)}σ
      </span>
    </div>
  );
}

function MetricLabel({ metric }: { metric: string }) {
  const colors: Record<string, string> = {
    spend: 'var(--accent-blue)',
    roas: 'var(--accent-purple)',
    cpa: 'var(--accent-yellow)',
    ctr: 'var(--accent-green)',
  };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      background: `${colors[metric] ?? 'var(--accent-blue)'}22`,
      color: colors[metric] ?? 'var(--accent-blue)',
    }}>
      {metric}
    </span>
  );
}

function AnomalyCard({ a }: { a: AnomalyRecord }) {
  const isCritical = a.severity === 'CRITICAL';
  const isPositive = a.z_score > 0;
  const metricDisplay: Record<string, (v: number) => string> = {
    spend: (v) => '€' + v.toFixed(0),
    roas: (v) => v.toFixed(2) + 'x',
    cpa: (v) => '€' + v.toFixed(1),
    ctr: (v) => v.toFixed(2) + '%',
  };
  const fmt = metricDisplay[a.metric] ?? ((v: number) => v.toFixed(2));

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${isCritical ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.25)'}`,
      borderRadius: 'var(--radius-md)',
      padding: '18px 20px',
      borderLeft: `3px solid ${isCritical ? 'var(--accent-red)' : 'var(--accent-yellow)'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span className={`alert-badge ${isCritical ? 'critical' : 'warning'}`}>
              {isCritical ? '🔴 Kritické' : '🟡 Varovanie'}
            </span>
            <MetricLabel metric={a.metric} />
          </div>
          <div style={{ fontWeight: 600, fontSize: '15px' }}>
            {a.campaign_name ?? `Campaign ${a.campaign_id}`}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            ID: {a.campaign_id} · Account: {a.account_id}
          </div>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {timeAgo(a.detected_at)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '12px', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>Aktuálna hodnota</div>
          <div style={{
            fontSize: '20px', fontWeight: 800,
            color: isPositive ? (a.metric === 'roas' ? 'var(--accent-green)' : 'var(--accent-red)') :
                              (a.metric === 'roas' || a.metric === 'ctr' ? 'var(--accent-red)' : 'var(--accent-green)')
          }}>
            {fmt(a.current_value)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>Priemer 21 dní</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {fmt(a.baseline_mean)} <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>± {a.baseline_std.toFixed(1)}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>Z-skóre (odchýlka od priemeru)</div>
          <ZScoreGauge z={a.z_score} />
        </div>
      </div>
    </div>
  );
}

export default async function AnomaliesPage() {
  const anomalies = getMockAnomalies();
  const critical = anomalies.filter((a) => a.severity === 'CRITICAL');
  const warnings = anomalies.filter((a) => a.severity !== 'CRITICAL');

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Anomálie</div>
          <div className="page-subtitle">Z-skóre detekcia · 21-dňové okno · Automatické Slack notifikácie</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {critical.length > 0 && <span className="alert-badge critical">{critical.length} kritické</span>}
          {warnings.length > 0 && <span className="alert-badge warning">{warnings.length} varovania</span>}
          {anomalies.length === 0 && <span className="alert-badge ok">Všetko v norme ✓</span>}
        </div>
      </div>

      <div className="page-body">
        {/* Explanation */}
        <div style={{ marginBottom: '20px', padding: '14px 18px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: '13px', lineHeight: '1.7' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Ako funguje detekcia:</strong>{' '}
          Systém vypočíta Z-skóre pre každú metriku (spend, ROAS, CPA, CTR) porovnaním dnešnej hodnoty
          s kĺzavým priemerom ± štandardná odchýlka za posledných 21 dní.{' '}
          <span style={{ color: 'var(--accent-yellow)' }}>|Z| ≥ 2.0 → Varovanie</span>,{' '}
          <span style={{ color: 'var(--accent-red)' }}>|Z| ≥ 3.0 → Kritické</span>.
          Kritické anomálie sú automaticky odoslané na Slack.
        </div>

        {/* Critical */}
        {critical.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--accent-red)', marginBottom: '12px' }}>
              🔴 Kritické ({critical.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {critical.map((a, i) => <AnomalyCard key={i} a={a} />)}
            </div>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--accent-yellow)', marginBottom: '12px' }}>
              🟡 Varovania ({warnings.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {warnings.map((a, i) => <AnomalyCard key={i} a={a} />)}
            </div>
          </div>
        )}

        {anomalies.length === 0 && (
          <div className="empty-state">
            <h3>Žiadne aktívne anomálie</h3>
            <p>Všetky kampane sú v norme. Systém kontroluje každých 15 minút.</p>
          </div>
        )}
      </div>
    </>
  );
}
