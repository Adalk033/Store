import { Package, Archive, ShoppingCart, Users, Calculator, BarChart3, Settings } from 'lucide-react';
import styles from './Sidebar.module.css';

export type PageId = 'products' | 'inventory' | 'pos' | 'credits' | 'cashRegister' | 'reports' | 'settings';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: typeof Package; disabled?: boolean }> = [
  { id: 'products', label: 'Productos', icon: Package },
  { id: 'inventory', label: 'Inventario', icon: Archive },
  { id: 'pos', label: 'Punto de Venta', icon: ShoppingCart, disabled: true },
  { id: 'credits', label: 'Creditos', icon: Users, disabled: true },
  { id: 'cashRegister', label: 'Caja', icon: Calculator, disabled: true },
  { id: 'reports', label: 'Reportes', icon: BarChart3, disabled: true },
  { id: 'settings', label: 'Configuracion', icon: Settings, disabled: true },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles['sidebar__logo']}>
        <div className={styles['sidebar__logo-text']}>MichiPapeleria</div>
        <div className={styles['sidebar__logo-subtitle']}>Punto de Venta</div>
      </div>
      <nav className={styles['sidebar__nav']}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`${styles['sidebar__item']} ${currentPage === item.id ? styles['sidebar__item--active'] : ''}`}
            onClick={() => onNavigate(item.id)}
            disabled={item.disabled}
            style={item.disabled ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
          >
            <item.icon className={styles['sidebar__item-icon']} strokeWidth={1.5} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
