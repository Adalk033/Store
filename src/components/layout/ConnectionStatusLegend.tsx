import styles from './ConnectionStatusLegend.module.css';

export type ConnectionStatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface ConnectionStatusItem {
  value: string;
  tone?: ConnectionStatusTone;
}

interface ConnectionStatusLegendProps {
  items: ConnectionStatusItem[];
  compact?: boolean;
}

const TONE_CLASSNAMES: Record<ConnectionStatusTone, string> = {
  success: styles['connection-status-legend__item--success'],
  warning: styles['connection-status-legend__item--warning'],
  error: styles['connection-status-legend__item--error'],
  info: styles['connection-status-legend__item--info'],
  neutral: styles['connection-status-legend__item--neutral'],
};

export function ConnectionStatusLegend({ items, compact = false }: ConnectionStatusLegendProps) {
  const legendClass = styles['connection-status-legend'];
  return (
    <div
      className={compact ? `${legendClass} ${styles['connection-status-legend--compact']}` : legendClass}
      aria-label="Leyenda de conexion"
    >
      {items.map(item => {
        const tone = item.tone ?? 'neutral';

        return (
          <div key={item.value} className={`${styles['connection-status-legend__item']} ${TONE_CLASSNAMES[tone]}`}>
            <span className={styles['connection-status-legend__dot']} aria-hidden="true" />
            <span className={styles['connection-status-legend__value']}>{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}
