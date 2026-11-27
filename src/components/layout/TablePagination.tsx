import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TableButton } from './TableButton';
import styles from './TablePagination.module.css';

interface TablePaginationProps {
  label: string;
  page: number;
  totalPages: number;
  totalRows?: number;
  hasNext?: boolean;
  className?: string;
  onPrevious: () => void;
  onNext: () => void;
}

export function TablePagination({
  label, page, totalPages, totalRows, hasNext = page < totalPages, className, onPrevious, onNext,
}: TablePaginationProps) {
  const classes = [styles['table-pagination'], className].filter(Boolean).join(' ');

  return (
    <nav className={classes} aria-label={label}>
      <TableButton onClick={onPrevious} disabled={page <= 1}>
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
        Anterior
      </TableButton>
      <span className={styles['table-pagination__page']}>
        Página {page} de {totalPages}
        {totalRows !== undefined ? ` (${totalRows})` : ''}
      </span>
      <TableButton onClick={onNext} disabled={!hasNext}>
        Siguiente
        <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
      </TableButton>
    </nav>
  );
}
