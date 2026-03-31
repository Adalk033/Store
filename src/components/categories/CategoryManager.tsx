import { useState } from 'react';
import { Plus, Pencil, Trash2, FolderOpen, Folder, ChevronRight, ChevronDown, X } from 'lucide-react';
import { useCategories } from '../../hooks/useCategories';
import { useProducts } from '../../hooks/useProducts';
import type { Category } from '../../types';
import styles from './CategoryManager.module.css';

interface CategoryManagerProps {
  showHeader?: boolean;
}

export function CategoryManager({ showHeader = true }: CategoryManagerProps) {
  const {
    categories,
    rootCategories,
    getChildren,
    loading,
    error,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useCategories();
  const { products } = useProducts();

  const [formName, setFormName] = useState('');
  const [formParentId, setFormParentId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<{
    id: number;
    name: string;
    productCount: number;
  } | null>(null);

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function startEdit(category: Category) {
    setEditingId(category.id);
    setFormName(category.name);
    setFormParentId(category.parent_id);
    setFormError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setFormName('');
    setFormParentId(null);
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = formName.trim();
    if (!trimmed) {
      setFormError('El nombre es obligatorio');
      return;
    }

    try {
      setFormError(null);
      if (editingId !== null) {
        await updateCategory(editingId, { name: trimmed, parent_id: formParentId });
      } else {
        await createCategory({ name: trimmed, parent_id: formParentId });
      }
      cancelEdit();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar');
    }
  }

  function getAssociatedProductCount(categoryId: number): number {
    return products.filter(p => p.category_id === categoryId).length;
  }

  function handleDeleteRequest(category: Category) {
    const children = getChildren(category.id);
    if (children.length > 0) {
      setFormError('No se puede eliminar una categoria con subcategorias');
      return;
    }

    setFormError(null);
    setDeleteCandidate({
      id: category.id,
      name: category.name,
      productCount: getAssociatedProductCount(category.id),
    });
  }

  function handleCloseDeleteModal() {
    setDeleteCandidate(null);
  }

  async function handleConfirmDelete() {
    if (!deleteCandidate) {
      return;
    }

    const children = getChildren(deleteCandidate.id);
    if (children.length > 0) {
      setFormError('No se puede eliminar una categoria con subcategorias');
      handleCloseDeleteModal();
      return;
    }

    try {
      setFormError(null);
      await deleteCategory(deleteCandidate.id);
      if (editingId === deleteCandidate.id) {
        cancelEdit();
      }
      handleCloseDeleteModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al eliminar');
      handleCloseDeleteModal();
    }
  }

  function renderCategoryItem(category: Category) {
    const children = getChildren(category.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(category.id);

    return (
      <li key={category.id}>
        <div className={styles['tree__item']}>
          <span className={styles['tree__item-name']}>
            {hasChildren ? (
              <button
                className={styles['btn-icon']}
                onClick={() => toggleExpand(category.id)}
              >
                {isExpanded
                  ? <ChevronDown size={16} strokeWidth={1.5} />
                  : <ChevronRight size={16} strokeWidth={1.5} />
                }
              </button>
            ) : (
              <span style={{ width: 24 }} />
            )}
            {hasChildren
              ? <FolderOpen size={16} strokeWidth={1.5} />
              : <Folder size={16} strokeWidth={1.5} />
            }
            {category.name}
          </span>
          <span className={styles['tree__item-actions']}>
            <button className={styles['btn-icon']} onClick={() => startEdit(category)} title="Editar">
              <Pencil size={14} strokeWidth={1.5} />
            </button>
            <button
              className={`${styles['btn-icon']} ${styles['btn-icon--danger']}`}
              onClick={() => handleDeleteRequest(category)}
              title="Eliminar"
            >
              <Trash2 size={14} strokeWidth={1.5} />
            </button>
          </span>
        </div>
        {hasChildren && isExpanded && (
          <ul className={styles['tree__children']}>
            {children.map(child => (
              <li key={child.id}>
                <div className={styles['tree__child']}>
                  <span>{child.name}</span>
                  <span className={styles['tree__child-actions']}>
                    <button className={styles['btn-icon']} onClick={() => startEdit(child)} title="Editar">
                      <Pencil size={14} strokeWidth={1.5} />
                    </button>
                    <button
                      className={`${styles['btn-icon']} ${styles['btn-icon--danger']}`}
                      onClick={() => handleDeleteRequest(child)}
                      title="Eliminar"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className={styles.manager}>
      {showHeader && (
        <div className={styles['manager__header']}>
          <h1 className={styles['manager__title']}>Categorias</h1>
        </div>
      )}

      {error && <p className={styles['error-text']}>{error}</p>}

      <div className={styles['manager__grid']}>
        {/* Category tree */}
        <div className={styles['tree-card']}>
          <h2 className={styles['tree-card__title']}>Arbol de categorias</h2>
          {loading ? (
            <p className={styles['tree__empty']}>Cargando...</p>
          ) : rootCategories.length === 0 ? (
            <p className={styles['tree__empty']}>No hay categorias registradas</p>
          ) : (
            <ul className={styles['tree__list']}>
              {rootCategories.map(cat => renderCategoryItem(cat))}
            </ul>
          )}
        </div>

        {/* Create/Edit form */}
        <div className={styles['form-card']}>
          <h2 className={styles['form-card__title']}>
            {editingId !== null ? 'Editar categoria' : 'Nueva categoria'}
          </h2>
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles['form__field']}>
              <label className={styles['form__label']}>Nombre</label>
              <input
                className={styles['form__input']}
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Nombre de la categoria"
              />
            </div>
            <div className={styles['form__field']}>
              <label className={styles['form__label']}>Categoria padre (opcional)</label>
              <select
                className={styles['form__select']}
                value={formParentId ?? ''}
                onChange={e => setFormParentId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Sin padre (raiz)</option>
                {rootCategories
                  .filter(c => c.id !== editingId)
                  .map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))
                }
              </select>
            </div>
            {formError && <p className={styles['error-text']}>{formError}</p>}
            <div className={styles['form__actions']}>
              <button type="submit" className={styles['btn-primary']}>
                <Plus size={16} strokeWidth={1.5} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                {editingId !== null ? 'Guardar' : 'Crear'}
              </button>
              {editingId !== null && (
                <button type="button" className={styles['btn-secondary']} onClick={cancelEdit}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {deleteCandidate && (
        <div className={styles['modal-overlay']} role="dialog" aria-modal="true" aria-labelledby="delete-category-title">
          <div className={styles.modal}>
            <div className={styles['modal__header']}>
              <h3 id="delete-category-title" className={styles['modal__title']}>
                Confirmar eliminacion
              </h3>
              <button
                type="button"
                className={styles['modal__close']}
                onClick={handleCloseDeleteModal}
                aria-label="Cerrar modal"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>

            <p className={styles['modal__text']}>
              Estas seguro que deseas eliminar la categoria "{deleteCandidate.name}"?
            </p>
            <p className={styles['modal__warning']}>
              Hay {deleteCandidate.productCount} articulo{deleteCandidate.productCount === 1 ? '' : 's'} asociado{deleteCandidate.productCount === 1 ? '' : 's'} a esta categoria.
            </p>

            <div className={styles['modal__actions']}>
              <button type="button" className={styles['btn-secondary']} onClick={handleCloseDeleteModal}>
                Cancelar
              </button>
              <button type="button" className={styles['btn-danger']} onClick={handleConfirmDelete}>
                Eliminar categoria
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
