import type { ComponentProps } from 'react';
import styles from './TableButton.module.css';

interface TableButtonProps extends ComponentProps<'button'> {
  variant?: 'icon' | 'link';
  tone?: 'danger';
}

export function TableButton({ variant, tone, className, type = 'button', ...props }: TableButtonProps) {
  const classes = [
    styles['table-button'],
    variant && styles[`table-button--${variant}`],
    tone && styles[`table-button--${tone}`],
    className,
  ].filter(Boolean).join(' ');

  return <button {...props} className={classes} type={type} />;
}
