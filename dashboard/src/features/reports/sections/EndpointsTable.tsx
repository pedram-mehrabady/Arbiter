import { useState } from 'react';
import css from './EndpointsTable.module.css';

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  count: number;
  avg_ms: number;
  module: string;
}

const ENDPOINTS: Endpoint[] = [
  { method: 'GET',    path: '/api/dms/files/:id',       count: 445, avg_ms: 18,  module: 'dms'          },
  { method: 'GET',    path: '/api/contacts/search',      count: 423, avg_ms: 41,  module: 'contacts'     },
  { method: 'GET',    path: '/api/contacts',             count: 312, avg_ms: 28,  module: 'contacts'     },
  { method: 'GET',    path: '/api/share/:token',         count: 218, avg_ms: 23,  module: 'share'        },
  { method: 'GET',    path: '/api/dms/folders',          count: 201, avg_ms: 31,  module: 'dms'          },
  { method: 'GET',    path: '/api/contacts/:id',         count: 189, avg_ms: 19,  module: 'contacts'     },
  { method: 'GET',    path: '/api/share',                count: 156, avg_ms: 34,  module: 'share'        },
  { method: 'POST',   path: '/api/dms/upload',           count: 78,  avg_ms: 342, module: 'dms'          },
  { method: 'PUT',    path: '/api/contacts/:id',         count: 67,  avg_ms: 134, module: 'contacts'     },
  { method: 'POST',   path: '/api/contacts',             count: 45,  avg_ms: 156, module: 'contacts'     },
  { method: 'POST',   path: '/api/share',                count: 42,  avg_ms: 87,  module: 'share'        },
  { method: 'POST',   path: '/api/share/:id/accept',     count: 31,  avg_ms: 112, module: 'share'        },
  { method: 'DELETE', path: '/api/dms/files/:id',        count: 14,  avg_ms: 67,  module: 'dms'          },
  { method: 'DELETE', path: '/api/contacts/:id',         count: 12,  avg_ms: 89,  module: 'contacts'     },
  { method: 'GET',    path: '/api/devices',              count: 8,   avg_ms: 22,  module: 'devices'      },
  { method: 'DELETE', path: '/api/devices/:id',          count: 3,   avg_ms: 45,  module: 'devices'      },
  { method: 'GET',    path: '/api/subscription/plan',    count: 97,  avg_ms: 29,  module: 'subscription' },
  { method: 'POST',   path: '/api/subscription/upgrade', count: 5,   avg_ms: 210, module: 'subscription' },
];

const MODULES = ['All', 'dms', 'contacts', 'share', 'devices', 'subscription'];

const METHOD_CLASS: Record<string, string> = {
  GET: 'methodGet', POST: 'methodPost', PUT: 'methodPut',
  DELETE: 'methodDelete', PATCH: 'methodPatch',
};

function msColor(ms: number) {
  if (ms < 100) return '#16a34a';
  if (ms < 300) return '#d97706';
  return '#dc2626';
}

export function EndpointsTable() {
  const [filter, setFilter] = useState('All');

  const rows = filter === 'All' ? ENDPOINTS : ENDPOINTS.filter((e) => e.module === filter);

  return (
    <div className={css.wrap}>
      <div className={css.sectionTitle}>Endpoints</div>
      <div className={css.filters}>
        {MODULES.map((m) => (
          <button key={m} className={`${css.chip}${filter === m ? ' ' + css.chipActive : ''}`} onClick={() => setFilter(m)}>
            {m}
          </button>
        ))}
      </div>
      <div className={css.tableWrap}>
        <div className={css.thead}>
          <span className={css.colMethod}>Method</span>
          <span className={css.colPath}>Path</span>
          <span className={css.colCount}>Count</span>
          <span className={css.colMs}>Avg ms</span>
        </div>
        {rows.map((e, i) => (
          <div key={i} className={css.row}>
            <span className={css.colMethod}><span className={`${css.badge} ${css[METHOD_CLASS[e.method]]}`}>{e.method}</span></span>
            <span className={css.colPath}>{e.path}</span>
            <span className={css.colCount}>{e.count.toLocaleString()}</span>
            <span className={css.colMs} style={{ color: msColor(e.avg_ms) }}>{e.avg_ms}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
