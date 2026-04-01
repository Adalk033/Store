import { type ReactNode } from 'react';
import { Sidebar, type PageId } from './Sidebar';
import styles from './MainLayout.module.css';

interface MainLayoutProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  storeName: string;
  isNavigating?: boolean;
  children: ReactNode;
}

export function MainLayout({ currentPage, onNavigate, storeName, isNavigating = false, children }: MainLayoutProps) {
  return (
    <div className={styles.layout}>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} storeName={storeName} />
      <main className={styles['layout__content']}>
        {children}
        {isNavigating ? (
          <div className={styles['layout__loader-overlay']} role="status" aria-live="polite" aria-label="Cargando vista">
            <div className={styles['layout__loader-card']}>
              <span className={styles['layout__loader-spinner']} aria-hidden="true" />
              <span>Cargando vista...</span>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
