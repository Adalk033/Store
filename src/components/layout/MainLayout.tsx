import { type ReactNode } from 'react';
import { Sidebar, type PageId } from './Sidebar';
import styles from './MainLayout.module.css';

interface MainLayoutProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  storeName: string;
  children: ReactNode;
}

export function MainLayout({ currentPage, onNavigate, storeName, children }: MainLayoutProps) {
  return (
    <div className={styles.layout}>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} storeName={storeName} />
      <main className={styles['layout__content']}>
        {children}
      </main>
    </div>
  );
}
