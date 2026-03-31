import { Package, Archive, ShoppingCart, Users, User, Calculator, BarChart3, Tag, Settings, Receipt } from 'lucide-react';
import styles from './Sidebar.module.css';

export type PageId = 'products' | 'inventory' | 'pos' | 'sales' | 'credits' | 'customers' | 'cashRegister' | 'reports' | 'barcodeLabels' | 'settings';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  storeName: string;
}

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: typeof Package; disabled?: boolean }> = [
  { id: 'products', label: 'Productos', icon: Package },
  { id: 'inventory', label: 'Inventario', icon: Archive },
  { id: 'pos', label: 'Punto de Venta', icon: ShoppingCart },
  { id: 'sales', label: 'Ventas', icon: Receipt },
  { id: 'credits', label: 'Creditos', icon: Users },
  { id: 'customers', label: 'Clientes', icon: User },
  { id: 'cashRegister', label: 'Caja', icon: Calculator },
  { id: 'reports', label: 'Reportes', icon: BarChart3 },
  { id: 'barcodeLabels', label: 'Etiquetas', icon: Tag },
  { id: 'settings', label: 'Configuracion', icon: Settings },
];

export function Sidebar({ currentPage, onNavigate, storeName }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles['sidebar__logo']}>
        <div className={styles['sidebar__logo-text']}>{storeName}</div>
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
