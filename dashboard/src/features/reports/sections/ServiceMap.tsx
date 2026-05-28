import css from './ServiceMap.module.css';

interface ServiceNode {
  id: string;
  name: string;
  reqs: number;
  avgMs: number;
  errors: number;
}

const SERVICES: ServiceNode[] = [
  { id: 'share',        name: 'Share',        reqs: 455,  avgMs: 40, errors: 1 },
  { id: 'dms',          name: 'DMS',          reqs: 738,  avgMs: 57, errors: 3 },
  { id: 'devices',      name: 'Devices',      reqs: 0,    avgMs: 0,  errors: 0 },
  { id: 'contacts',     name: 'Contacts',     reqs: 1048, avgMs: 45, errors: 2 },
  { id: 'subscription', name: 'Subscription', reqs: 0,    avgMs: 0,  errors: 0 },
];

const W = 800, H = 560;
const SVC_X = 140;
const SVC_Y_START = 55;
const SVC_SPACING = 100;
const PG_X = 590;
const PG_Y = 275;

function healthColor(s: ServiceNode) {
  if (s.reqs === 0) return '#4b5563';
  if (s.errors / Math.max(s.reqs, 1) > 0.05) return '#ef4444';
  if (s.avgMs > 300) return '#f59e0b';
  return '#10b981';
}

function lineWidth(reqs: number) {
  if (reqs === 0) return 0.5;
  if (reqs < 100) return 1.5;
  if (reqs < 500) return 2.5;
  return 4;
}

export function ServiceMap() {
  return (
    <div className={css.wrap}>
      <div className={css.sectionTitle}>Service Map</div>
      <div className={css.box}>

        {/* Top bar */}
        <div className={css.topBar}>
          <div className={css.legend}>
            <span className={css.lgItem}><span className={css.lgDot} style={{ background: '#10b981' }} />Healthy</span>
            <span className={css.lgItem}><span className={css.lgDot} style={{ background: '#f59e0b' }} />Slow (&gt;300ms)</span>
            <span className={css.lgItem}><span className={css.lgDot} style={{ background: '#ef4444' }} />Errors (&gt;5%)</span>
            <span className={css.lgItem}><span className={css.lgDot} style={{ background: '#4b5563' }} />No traffic</span>
          </div>
          <span className={css.lgHint}>Line thickness = request volume</span>
        </div>

        {/* Graph area */}
        <div className={css.content}>
          <div className={css.graphArea}>
            <svg viewBox={`0 0 ${W} ${H}`} className={css.svg} preserveAspectRatio="xMidYMid meet">
              <defs>
                {SERVICES.map((s) => (
                  <radialGradient key={s.id} id={`halo-svc-${s.id}`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={healthColor(s)} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={healthColor(s)} stopOpacity="0" />
                  </radialGradient>
                ))}
                <radialGradient id="halo-pg" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* PG glow halo */}
              <ellipse cx={PG_X} cy={PG_Y} rx={110} ry={90} fill="url(#halo-pg)" />

              {/* Service glow halos */}
              {SERVICES.map((s, i) => {
                const cy = SVC_Y_START + i * SVC_SPACING + 30;
                return (
                  <ellipse key={s.id} cx={SVC_X} cy={cy} rx={72} ry={58}
                    fill={`url(#halo-svc-${s.id})`} />
                );
              })}

              {/* Connection lines */}
              {SERVICES.map((s, i) => {
                const sy = SVC_Y_START + i * SVC_SPACING + 30;
                const color = healthColor(s);
                const w = lineWidth(s.reqs);
                return (
                  <path
                    key={s.id}
                    d={`M ${SVC_X + 38} ${sy} C ${SVC_X + 180} ${sy}, ${PG_X - 180} ${PG_Y}, ${PG_X - 52} ${PG_Y}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={w}
                    strokeOpacity={s.reqs === 0 ? 0.12 : 0.55}
                  />
                );
              })}

              {/* Request count labels */}
              {SERVICES.filter((s) => s.reqs > 0).map((s) => {
                const i = SERVICES.indexOf(s);
                const sy = SVC_Y_START + i * SVC_SPACING + 30;
                const lx = (SVC_X + 38 + PG_X - 52) / 2;
                const ly = (sy + PG_Y) / 2 - 8;
                return (
                  <text key={s.id} x={lx} y={ly} className={css.lineLabel} textAnchor="middle">
                    {s.reqs.toLocaleString()} req
                  </text>
                );
              })}

              {/* Service nodes */}
              {SERVICES.map((s, i) => {
                const cy = SVC_Y_START + i * SVC_SPACING;
                const color = healthColor(s);
                return (
                  <g key={s.id}>
                    <circle cx={SVC_X} cy={cy + 30} r={38} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.75} />
                    <circle cx={SVC_X} cy={cy + 30} r={32} fill={color} fillOpacity={0.12} />
                    <text x={SVC_X} y={cy + 26} textAnchor="middle" className={css.nodeName}>{s.name}</text>
                    <text x={SVC_X} y={cy + 40} textAnchor="middle" className={css.nodeSub}>
                      {s.reqs > 0 ? `${s.reqs.toLocaleString()} req · ${s.avgMs}ms` : 'idle'}
                    </text>
                    {s.errors > 0 && (
                      <text x={SVC_X} y={cy + 52} textAnchor="middle" className={css.nodeErr}>
                        {s.errors} err
                      </text>
                    )}
                  </g>
                );
              })}

              {/* PostgreSQL cylinder */}
              <ellipse cx={PG_X} cy={PG_Y - 28} rx={52} ry={15}
                fill="#10b981" fillOpacity={0.2} stroke="#10b981" strokeWidth={1.5} strokeOpacity={0.65} />
              <rect x={PG_X - 52} y={PG_Y - 28} width={104} height={56}
                fill="#10b981" fillOpacity={0.07} />
              <ellipse cx={PG_X} cy={PG_Y + 28} rx={52} ry={15}
                fill="#10b981" fillOpacity={0.15} stroke="#10b981" strokeWidth={1.5} strokeOpacity={0.65} />
              <text x={PG_X} y={PG_Y + 6} textAnchor="middle" className={css.pgLabel}>PostgreSQL</text>
              <text x={PG_X} y={PG_Y + 58} textAnchor="middle" className={css.pgSub}>5 schemas</text>
            </svg>
          </div>
        </div>

      </div>
    </div>
  );
}
