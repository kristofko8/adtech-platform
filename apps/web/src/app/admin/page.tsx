import { getMockQueueStats } from '../../lib/api';
import type { QueueStats } from '../../lib/api';

// ── Pomocné komponenty ────────────────────────────────────────────────────────

function QueueStatusDot({ isPaused, failed }: { isPaused: boolean; failed: number }) {
  if (isPaused) return <span className="status-dot yellow" title="Pozastavená" />;
  if (failed > 0) return <span className="status-dot red" title={`${failed} zlyhaných jobov`} />;
  return <span className="status-dot green" title="Beží normálne" />;
}

function QueueCard({ q }: { q: QueueStats }) {
  const hasFailed = q.failed > 0;
  const isHealthy = !q.isPaused && q.failed === 0;

  const counts: { label: string; val: number; color: string }[] = [
    { label: 'Čaká',       val: q.waiting,   color: 'var(--accent-blue)' },
    { label: 'Aktívne',    val: q.active,     color: 'var(--accent-green)' },
    { label: 'Dokončené',  val: q.completed,  color: 'var(--text-muted)' },
    { label: 'Zlyhané',    val: q.failed,     color: 'var(--accent-red)' },
    { label: 'Oneskorené', val: q.delayed,    color: 'var(--accent-yellow)' },
    { label: 'Pozastavené',val: q.paused ?? 0,color: 'var(--accent-yellow)' },
  ];

  return (
    <div className={`queue-card${hasFailed ? ' has-failed' : ''}`}>
      <div className="queue-name">
        <QueueStatusDot isPaused={q.isPaused} failed={q.failed} />
        {q.name}
        {isHealthy && (
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--accent-green)', fontWeight: 600 }}>
            OK
          </span>
        )}
        {q.isPaused && (
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--accent-yellow)', fontWeight: 600 }}>
            PAUSED
          </span>
        )}
      </div>

      <div className="queue-counts">
        {counts.map(({ label, val, color }) => (
          <div className="queue-count-item" key={label}>
            <div className="queue-count-dot" style={{ background: color }} />
            <span className="queue-count-label">{label}</span>
            <span
              className="queue-count-val"
              style={{ color: label === 'Zlyhané' && val > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}
            >
              {val.toLocaleString('sk-SK')}
            </span>
          </div>
        ))}
      </div>

      {hasFailed && (
        <div style={{
          marginTop: '12px',
          padding: '8px 10px',
          background: 'var(--accent-red-dim)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>
            ⚠ {q.failed} zlyhaných jobov
          </span>
          <a
            href={`/admin/bull#/queues/${q.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
            style={{ fontSize: '11px', padding: '3px 8px' }}
          >
            Zobraziť v BullBoard →
          </a>
        </div>
      )}
    </div>
  );
}

function HealthBar({ queues }: { queues: QueueStats[] }) {
  const totalFailed = queues.reduce((s, q) => s + q.failed, 0);
  const totalActive = queues.reduce((s, q) => s + q.active, 0);
  const totalWaiting = queues.reduce((s, q) => s + q.waiting, 0);
  const totalCompleted = queues.reduce((s, q) => s + q.completed, 0);
  const anyPaused = queues.some((q) => q.isPaused);

  const health = totalFailed === 0 && !anyPaused ? 'ok' : totalFailed > 10 ? 'critical' : 'warning';

  return (
    <div style={{
      padding: '16px 20px',
      background: health === 'ok' ? 'var(--accent-green-dim)' :
                  health === 'critical' ? 'var(--accent-red-dim)' : 'var(--accent-yellow-dim)',
      border: `1px solid ${health === 'ok' ? 'rgba(34,197,94,0.3)' :
               health === 'critical' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
      borderRadius: 'var(--radius-md)',
      marginBottom: '24px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '12px',
    }}>
      <div>
        <div style={{
          fontWeight: 700,
          fontSize: '15px',
          color: health === 'ok' ? 'var(--accent-green)' :
                 health === 'critical' ? 'var(--accent-red)' : 'var(--accent-yellow)',
          marginBottom: '4px',
        }}>
          {health === 'ok' ? '✓ Všetky fronty sú zdravé' :
           health === 'critical' ? '✗ Kritické zlyhania — ihneď skontroluj' :
           '⚠ Niektoré joby zlyhali'}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {totalFailed === 0 ? 'Žiadne zlyhané joby' : `${totalFailed} zlyhaných jobov`}
          {anyPaused ? ' · Niektoré fronty sú pozastavené' : ''}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
        {[
          { label: 'Aktívne',   val: totalActive,    color: 'var(--accent-green)' },
          { label: 'Čaká',      val: totalWaiting,   color: 'var(--accent-blue)' },
          { label: 'Dokončené', val: totalCompleted,  color: 'var(--text-secondary)' },
          { label: 'Zlyhané',   val: totalFailed,     color: 'var(--accent-red)' },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '18px', color, fontFamily: 'var(--font-mono)' }}>
              {val.toLocaleString('sk-SK')}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AdminPage() {
  // V produkcii: await getQueueStats()
  const { queues, fetchedAt } = getMockQueueStats();

  const fetchedAgo = Math.round(
    (Date.now() - new Date(fetchedAt).getTime()) / 1000,
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Admin — Queue Monitoring</div>
          <div className="page-subtitle">
            BullMQ fronty · Redis · Posledná aktualizácia: pred {fetchedAgo}s
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            href="/admin/bull"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
            Otvoriť BullBoard UI
          </a>
        </div>
      </div>

      <div className="page-body">

        {/* Celkový health bar */}
        <HealthBar queues={queues} />

        {/* Queue karty */}
        <div className="queue-grid">
          {queues.map((q) => (
            <QueueCard key={q.name} q={q} />
          ))}
        </div>

        {/* Info sekcia o BullBoard */}
        <div className="card" style={{ marginTop: '8px' }}>
          <div className="card-header">
            <span className="card-title">BullBoard UI — Full Dashboard</span>
          </div>
          <div style={{ fontSize: '13px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
            <p style={{ marginBottom: '8px' }}>
              Pre detailný pohľad na joby, retry zlyhaných jobov, zobrazenie payloadu a progress
              otvor <strong>BullBoard UI</strong> na:
            </p>
            <code style={{
              display: 'block',
              padding: '10px 14px',
              background: 'var(--bg-base)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              color: 'var(--accent-blue)',
              marginBottom: '10px',
            }}>
              http://localhost:3000/admin/bull
            </code>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Prihlasovacie údaje sú nastavené cez env premenné:{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>BULL_BOARD_USER</code> a{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>BULL_BOARD_PASS</code>.
              Predvolené: <code style={{ fontFamily: 'var(--font-mono)' }}>admin / adtech-admin</code>.
            </p>
          </div>
        </div>

        {/* Retry endpoint info */}
        <div style={{
          marginTop: '16px',
          padding: '14px 18px',
          background: 'var(--accent-blue-dim)',
          border: '1px solid rgba(91,124,246,0.3)',
          borderRadius: 'var(--radius-md)',
          fontSize: '13px',
          lineHeight: '1.6',
        }}>
          <strong style={{ color: 'var(--accent-blue)' }}>🔄 REST API pre retry:</strong>{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            POST /api/v1/admin/queues/&#123;name&#125;/retry
          </code>{' '}
          — spustí retry všetkých zlyhaných jobov v danej fronte (vyžaduje JWT token).
        </div>
      </div>
    </>
  );
}
