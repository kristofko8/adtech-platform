// ============================================================
// CreativeCard — video preview karta s overlay metrikami
// Zobrazuje thumbnail, tier badge, ROAS, Hook/Hold rate bary
// ============================================================

import type { CreativeInsight, CreativeTier } from '../lib/api';

const TIER_COLOR: Record<CreativeTier, string> = {
  elite: 'var(--tier-elite)',
  strong: 'var(--tier-strong)',
  average: 'var(--tier-average)',
  'fix-it': 'var(--tier-fixit)',
};

const TIER_LABEL: Record<CreativeTier, string> = {
  elite: '★ Elite',
  strong: '↑ Strong',
  average: '→ Average',
  'fix-it': '✗ Fix-it',
};

const RANK_CLASS: Record<number, string> = {
  1: 'rank-gold',
  2: 'rank-silver',
  3: 'rank-bronze',
};

interface Props {
  creative: CreativeInsight;
  rank?: number;
  wowRoasChange?: number; // napr. +0.34 = +8.5% WoW
  wowSpendChange?: number;
}

export function CreativeCard({ creative: c, rank, wowRoasChange, wowSpendChange }: Props) {
  const hookPct = (c.hook_rate * 100).toFixed(1);
  const holdPct = (c.hold_rate * 100).toFixed(1);
  const hookBarW = Math.min(c.hook_rate / 0.6, 1) * 100;
  const holdBarW = Math.min(c.hold_rate / 0.7, 1) * 100;
  const roasColor =
    c.roas >= 4
      ? 'var(--accent-green)'
      : c.roas >= 2.5
        ? 'var(--accent-yellow)'
        : 'var(--accent-red)';

  return (
    <div className="creative-card">
      {/* Rank badge */}
      {rank !== undefined && (
        <div className={`creative-rank ${RANK_CLASS[rank] ?? ''}`}>#{rank}</div>
      )}

      {/* Thumbnail / placeholder */}
      <div className="creative-thumb">
        {c.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnail_url} alt={c.ad_name ?? c.creative_id} />
        ) : (
          <div className="creative-thumb-placeholder">
            {/* Video icon placeholder */}
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
              <rect x="2" y="6" width="15" height="12" rx="2" />
              <path d="M17 9l5-3v12l-5-3V9z" />
            </svg>
          </div>
        )}

        {/* Play button overlay */}
        <div className="creative-play">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <path d="M8 5v14l11-7L8 5z" />
          </svg>
        </div>

        {/* Tier badge — vľavo hore */}
        <div
          className="creative-tier-overlay"
          style={{ background: TIER_COLOR[c.performance_tier] }}
        >
          {TIER_LABEL[c.performance_tier]}
        </div>

        {/* ROAS badge — vpravo hore */}
        <div className="creative-roas-overlay" style={{ color: roasColor }}>
          {c.roas.toFixed(2)}x
          {wowRoasChange !== undefined && (
            <span style={{ fontSize: '9px', marginLeft: '3px', opacity: 0.8 }}>
              {wowRoasChange >= 0 ? '↑' : '↓'}
            </span>
          )}
        </div>
      </div>

      {/* Metriky */}
      <div className="creative-metrics">
        <div className="creative-name" title={c.ad_name ?? c.creative_id}>
          {c.ad_name ?? `Creative ${c.creative_id}`}
        </div>

        {/* Hook Rate bar */}
        <div className="creative-metric-row">
          <span className="creative-metric-label">Hook</span>
          <div className="creative-mini-bar">
            <div
              className="creative-mini-fill"
              style={{
                width: `${hookBarW}%`,
                background: TIER_COLOR[c.performance_tier],
              }}
            />
          </div>
          <span className="creative-metric-val">{hookPct}%</span>
        </div>

        {/* Hold Rate bar */}
        <div className="creative-metric-row">
          <span className="creative-metric-label">Hold</span>
          <div className="creative-mini-bar">
            <div
              className="creative-mini-fill"
              style={{
                width: `${holdBarW}%`,
                background: TIER_COLOR[c.performance_tier],
              }}
            />
          </div>
          <span className="creative-metric-val">{holdPct}%</span>
        </div>

        {/* Bottom stats row */}
        <div className="creative-bottom-stats">
          <span className="mono">€{c.total_spend.toLocaleString('sk-SK')}</span>
          <span>{c.total_conversions} konv.</span>
          <span style={{ color: 'var(--text-muted)' }}>
            {(c.total_impressions / 1_000).toFixed(0)}k imp.
          </span>
        </div>

        {/* WoW change */}
        {wowSpendChange !== undefined && (
          <div
            style={{
              fontSize: '11px',
              marginTop: '6px',
              color:
                wowSpendChange >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
              fontWeight: 600,
            }}
          >
            {wowSpendChange >= 0 ? '▲' : '▼'}{' '}
            {Math.abs(wowSpendChange * 100).toFixed(1)}% výdavky WoW
          </div>
        )}
      </div>
    </div>
  );
}
