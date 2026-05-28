import { useState } from 'react';
import css from './ModuleGraph.module.css';

// ── Data ──────────────────────────────────────────────────────────────────────

interface Mod {
  id: string; name: string; color: string;
  status: 'built' | 'planned';
  path: string; desc: string; conns: number;
  x: number; y: number;
}
interface Link { from: string; to: string; }

const W = 900, H = 580;
const CX = 450, CY = 280;

const MODS: Mod[] = [
  { id: 'dashboard',    name: 'Dashboard',    color: '#f59e0b', status: 'built',   path: 'web/src/features/dashboard/',     desc: 'Home screen & widgets',       conns: 6, x: CX,       y: CY       },
  { id: 'contacts',     name: 'Contacts',     color: '#10b981', status: 'built',   path: 'web/src/features/contacts/',      desc: 'CRM, search, detail panel',   conns: 3, x: CX + 230, y: CY       },
  { id: 'dms',          name: 'DMS',          color: '#8b5cf6', status: 'built',   path: 'web/src/features/dms/',           desc: 'Documents, upload, folders',  conns: 3, x: CX + 120, y: CY + 200 },
  { id: 'share',        name: 'Share',        color: '#ec4899', status: 'built',   path: 'web/src/features/share/',         desc: 'Inbox, envelopes, acceptance',conns: 3, x: CX - 120, y: CY + 200 },
  { id: 'subscription', name: 'Subscription', color: '#6366f1', status: 'built',   path: 'web/src/features/subscription/',  desc: 'Plans, addons, upgrade',      conns: 2, x: CX - 230, y: CY       },
  { id: 'notifications',name: 'Notifications',color: '#3b82f6', status: 'planned', path: 'web/src/features/notifications/', desc: 'Bell, unread count, feed',    conns: 1, x: CX - 120, y: CY - 200 },
  { id: 'contracts',    name: 'Contracts',    color: '#f97316', status: 'planned', path: 'web/src/features/contracts/',     desc: 'Lifecycle, approval engine',  conns: 1, x: CX + 120, y: CY - 200 },
];

const LINKS: Link[] = [
  { from: 'dashboard', to: 'contacts' }, { from: 'dashboard', to: 'dms' },
  { from: 'dashboard', to: 'share' },    { from: 'dashboard', to: 'subscription' },
  { from: 'dashboard', to: 'notifications' }, { from: 'dashboard', to: 'contracts' },
  { from: 'share', to: 'dms' },          { from: 'share', to: 'contacts' },
  { from: 'contacts', to: 'dms' },       { from: 'subscription', to: 'contacts' },
];

// ── Per-module detail ─────────────────────────────────────────────────────────

interface Comp { id: string; name: string; type: 'page'|'component'|'hook'|'api'; path: string; color: string; uses?: string[]; }
const DETAIL: Record<string, Comp[]> = {
  dashboard: [
    { id: 'dp', name: 'DashboardPage',  type: 'page',      path: 'pages/DashboardPage.tsx',    color: '#f59e0b', uses: ['jc', 'jd'] },
    { id: 'jc', name: 'JobCard',        type: 'component', path: 'components/JobCard.tsx',     color: '#f59e0b', uses: ['as'] },
    { id: 'jd', name: 'JobDetailModal', type: 'component', path: 'JobDetailModal.tsx',          color: '#fbbf24', uses: ['as'] },
    { id: 'as', name: 'useAppStore',    type: 'hook',      path: 'store/useAppStore.ts',       color: '#fcd34d' },
  ],
  contacts: [
    { id: 'cp', name: 'ContactsPage',       type: 'page',      path: 'pages/ContactsPage.tsx',                    color: '#10b981', uses: ['cd', 'ca'] },
    { id: 'cd', name: 'ContactDetailPanel', type: 'component', path: 'components/detail/ContactDetailPanel.tsx',  color: '#10b981', uses: ['uc'] },
    { id: 'uc', name: 'useContacts',        type: 'hook',      path: 'hooks/useContacts.ts',                      color: '#34d399', uses: ['ca'] },
    { id: 'ca', name: 'contacts API',       type: 'api',       path: 'api/ (index · live · mock)',                color: '#6ee7b7' },
  ],
  dms: [
    { id: 'dP', name: 'DmsPage',   type: 'page',      path: 'pages/DmsPage.tsx',          color: '#8b5cf6', uses: ['dU', 'dA'] },
    { id: 'dU', name: 'DmsUpload', type: 'component', path: 'components/DmsUpload.tsx',   color: '#8b5cf6', uses: ['dA'] },
    { id: 'dA', name: 'dms API',   type: 'api',       path: 'api/ (index · live · mock)', color: '#a78bfa' },
  ],
  share: [
    { id: 'sI', name: 'ShareInboxPage',       type: 'page', path: 'pages/ShareInboxPage.tsx',       color: '#ec4899', uses: ['sA'] },
    { id: 'sR', name: 'RecipientLandingPage', type: 'page', path: 'pages/RecipientLandingPage.tsx', color: '#ec4899', uses: ['sA'] },
    { id: 'sA', name: 'share API',            type: 'api',  path: 'api/ (index · live · mock)',     color: '#f472b6' },
  ],
  subscription: [
    { id: 'sp', name: 'SettingsPage',    type: 'page',      path: 'pages/SubscriptionSettingsPage.tsx', color: '#6366f1', uses: ['pm', 'ba'] },
    { id: 'pm', name: 'PlanPickerModal', type: 'component', path: 'components/PlanPickerModal.tsx',     color: '#6366f1', uses: ['uu'] },
    { id: 'uc2',name: 'useCapabilities', type: 'hook',      path: 'hooks/useCapabilities.ts',           color: '#818cf8', uses: ['ba'] },
    { id: 'uu', name: 'useUpgrade',      type: 'hook',      path: 'hooks/useUpgrade.ts',                color: '#818cf8', uses: ['ba'] },
    { id: 'ba', name: 'subscription API',type: 'api',       path: 'api/ (index · live · mock)',         color: '#a5b4fc' },
  ],
};

const TYPE_ORDER: Comp['type'][] = ['page', 'component', 'hook', 'api'];
const TYPE_LABEL: Record<Comp['type'], string> = { page: 'Pages', component: 'Components', hook: 'Hooks', api: 'API Layer' };

function modById(id: string) { return MODS.find((m) => m.id === id)!; }

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const cx = mx - dy * 0.18, cy = my + dx * 0.18;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

// ── Module overview ───────────────────────────────────────────────────────────

function ModuleOverview({ onDrill }: { onDrill: (id: string) => void }) {
  const [hov, setHov] = useState<string | null>(null);
  const CW = 136, CH = 72;

  return (
    <div className={css.graphArea}>
      <svg viewBox={`0 0 ${W} ${H}`} className={css.svg} preserveAspectRatio="xMidYMid meet">
        <defs>
          {MODS.map((m) => (
            <radialGradient key={m.id} id={`halo-${m.id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={m.color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={m.color} stopOpacity="0" />
            </radialGradient>
          ))}
          {LINKS.map((l, i) => {
            const a = modById(l.from), b = modById(l.to);
            return (
              <linearGradient key={i} id={`lg-${i}`} gradientUnits="userSpaceOnUse"
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                <stop offset="0%"   stopColor={a.color} stopOpacity="0.7" />
                <stop offset="100%" stopColor={b.color} stopOpacity="0.7" />
              </linearGradient>
            );
          })}
        </defs>

        {/* Glow halos */}
        {MODS.map((m) => (
          <ellipse key={m.id} cx={m.x} cy={m.y} rx={90} ry={70}
            fill={`url(#halo-${m.id})`} opacity={hov === m.id ? 1 : 0.45} />
        ))}

        {/* Links */}
        {LINKS.map((l, i) => {
          const a = modById(l.from), b = modById(l.to);
          const active = hov === l.from || hov === l.to;
          const planned = a.status === 'planned' || b.status === 'planned';
          return (
            <path key={i} d={bezier(a.x, a.y, b.x, b.y)} fill="none"
              stroke={active ? `url(#lg-${i})` : 'rgba(255,255,255,0.07)'}
              strokeWidth={active ? 2.5 : 1}
              strokeDasharray={planned ? '5 4' : undefined} />
          );
        })}

        {/* Cards as foreignObject so HTML renders inside SVG */}
        {MODS.map((m) => {
          const isBuilt = m.status === 'built';
          const canDrill = isBuilt && !!DETAIL[m.id];
          const isHov = hov === m.id;
          return (
            <foreignObject key={m.id}
              x={m.x - CW / 2} y={m.y - CH / 2}
              width={CW} height={CH + 20}
              style={{ overflow: 'visible' }}
            >
              <div
                className={`${css.modCard} ${isBuilt ? css.modCardBuilt : css.modCardPlanned} ${isHov ? css.modCardHov : ''}`}
                style={{
                  borderColor: isHov ? m.color : 'rgba(255,255,255,0.1)',
                  boxShadow: isHov ? `0 0 24px ${m.color}44, 0 0 0 1px ${m.color}66` : undefined,
                  width: CW, height: CH,
                }}
                onMouseEnter={() => setHov(m.id)}
                onMouseLeave={() => setHov(null)}
                onClick={() => canDrill && onDrill(m.id)}
              >
                <div className={css.accent} style={{ background: m.color }} />
                <div className={css.modBody}>
                  <div className={css.modName}>{m.name}</div>
                  <div className={css.modDesc}>{m.desc}</div>
                  <div className={css.modFoot}>
                    <span className={`${css.chip} ${isBuilt ? css.chipBuilt : css.chipPlanned}`}>
                      {isBuilt ? '✓ Built' : '◌ Planned'}
                    </span>
                    {canDrill && <span className={css.drillHint}>drill in ›</span>}
                  </div>
                </div>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}

// ── Drill-down detail ─────────────────────────────────────────────────────────

function ModuleDetail({ modId }: { modId: string }) {
  const mod   = modById(modId);
  const comps = DETAIL[modId] ?? [];
  const [hovComp, setHovComp] = useState<string | null>(null);

  const byType = TYPE_ORDER
    .map((t) => ({ type: t, items: comps.filter((c) => c.type === t) }))
    .filter((g) => g.items.length > 0);

  // Highlight: which ids are "connected" to the hovered comp
  const highlighted = hovComp
    ? new Set([hovComp, ...(comps.find((c) => c.id === hovComp)?.uses ?? [])])
    : null;

  return (
    <div className={css.detailWrap}>
      <div className={css.detailHeader} style={{ borderColor: mod.color + '80' }}>
        <span className={css.detailDot} style={{ background: mod.color }} />
        <span className={css.detailTitle}>{mod.name}</span>
        <span className={css.detailPath}>{mod.path}</span>
      </div>

      <div className={css.detailCols}>
        {byType.map((col, ci) => (
          <div key={col.type} className={css.detailColGroup}>
            <div className={css.colLabel}>{TYPE_LABEL[col.type]}</div>
            <div className={css.colCards}>
              {col.items.map((c) => {
                const dimmed = highlighted && !highlighted.has(c.id);
                return (
                  <div
                    key={c.id}
                    className={`${css.compCard} ${dimmed ? css.compDimmed : ''}`}
                    style={{ borderLeftColor: c.color }}
                    onMouseEnter={() => setHovComp(c.id)}
                    onMouseLeave={() => setHovComp(null)}
                  >
                    <div className={css.compName}>{c.name}</div>
                    <div className={css.compPath}>{c.path}</div>
                    {c.uses && c.uses.length > 0 && (
                      <div className={css.compUses}>
                        uses → {c.uses.map((uid) => comps.find((x) => x.id === uid)?.name).filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {ci < byType.length - 1 && <div className={css.colArrow}>›</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function ModuleGraph() {
  const [drilled, setDrilled] = useState<string | null>(null);

  const crumbMod = drilled ? modById(drilled) : null;

  return (
    <div className={css.wrap}>
      <div className={css.sectionTitle}>Module Graph</div>
      <div className={css.box}>

        {/* Top bar */}
        <div className={css.topBar}>
          <div className={css.breadcrumb}>
            <button className={`${css.crumb}${!drilled ? ' ' + css.crumbActive : ''}`}
              onClick={() => setDrilled(null)}>All modules</button>
            {crumbMod && (
              <>
                <span className={css.crumbSep}>›</span>
                <button className={`${css.crumb} ${css.crumbActive}`}
                  style={{ color: crumbMod.color }}>{crumbMod.name}</button>
              </>
            )}
          </div>
          {drilled && (
            <button className={css.backBtn} onClick={() => setDrilled(null)}>← Back to all modules</button>
          )}
          <div className={css.legend}>
            <span className={css.lgItem}><span className={css.lgDot} style={{ background: '#10b981' }} />Built</span>
            <span className={css.lgItem}><span className={css.lgDotPlanned} />Planned</span>
            <span className={css.lgHint}>{drilled ? 'Hover a card to see dependencies' : 'Click a built module to explore'}</span>
          </div>
        </div>

        {/* Content */}
        <div className={css.content}>
          {drilled
            ? <ModuleDetail modId={drilled} />
            : <ModuleOverview onDrill={setDrilled} />}
        </div>

      </div>
    </div>
  );
}
