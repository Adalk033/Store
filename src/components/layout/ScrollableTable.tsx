import type { ReactNode } from 'react';
import styles from './ScrollableTable.module.css';

interface ScrollableTableProps {
  className: string;
  children: ReactNode;
}

export function ScrollableTable({ className, children }: ScrollableTableProps) {
  return (
    <div className={styles['scrollable-table']}>
      <table className={className}>{children}</table>
    </div>
  );
}
