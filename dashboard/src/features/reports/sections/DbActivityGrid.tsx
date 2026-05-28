import css from './DbActivityGrid.module.css';

interface TableStat {
  name: string;
  reads: number;
  writes: number;
}

const TABLES: TableStat[] = [
  { name: 'contacts',                    reads: 1003, writes: 124 },
  { name: 'contact_phones',              reads: 924,  writes: 45  },
  { name: 'dms_files',                   reads: 660,  writes: 92  },
  { name: 'dms_folders',                 reads: 468,  writes: 78  },
  { name: 'contact_emails',              reads: 501,  writes: 45  },
  { name: 'share_envelopes',             reads: 413,  writes: 81  },
  { name: 'share_artifacts',             reads: 187,  writes: 42  },
  { name: 'dms_documents',               reads: 218,  writes: 0   },
  { name: 'subscription.subscriptions',  reads: 0,    writes: 0   },
  { name: 'subscription.seat_licenses',  reads: 0,    writes: 0   },
];

export function DbActivityGrid() {
  return (
    <div className={css.wrap}>
      <div className={css.sectionTitle}>DB Table Activity</div>
      <div className={css.legend}>
        Bar color: <span className={css.legendRead}>blue = read-heavy</span>
        {' → '}
        <span className={css.legendWrite}>amber = write-heavy</span>
      </div>
      <div className={css.grid}>
        {TABLES.map((t) => {
          const total = t.reads + t.writes;
          const readPct = total > 0 ? (t.reads / total) * 100 : 0;
          return (
            <div key={t.name} className={css.card}>
              <div className={css.tableName}>{t.name}</div>
              <div className={css.totalOps}>{total.toLocaleString()} ops</div>
              <div className={css.bar}>
                <div className={css.barFill} style={{ width: readPct + '%' }} />
              </div>
              <div className={css.rwRow}>
                <span className={css.reads}>R {t.reads.toLocaleString()}</span>
                <span className={css.writes}>W {t.writes.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
