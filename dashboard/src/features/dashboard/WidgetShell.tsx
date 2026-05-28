import styles from './WidgetShell.module.css';

interface Props {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function WidgetShell({ title, children, actions }: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {actions && <div className={styles.headerActions}>{actions}</div>}
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
