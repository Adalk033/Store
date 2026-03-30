import { useState } from 'react';
import { Plus, Pencil, Trash2, FolderOpen, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { useCategories } from '../../hooks/useCategories';
import type { Category } from '../../types';
import styles from './CategoryManager.module.css';

export function CategoryManager() {
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

  const [formName, setFormName] = useState('');
  const [formParentId, setFormParentId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

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

  async function handleDelete(id: number) {
    const children = getChildren(id);
    if (children.length > 0) {
      setFormError('No se puede eliminar una categoria con subcategorias');
      return;
    }
    // Check if any products use this category
    const productsInCategory = categories.filter(c => c.id === id);
    if (productsInCategory.length === 0) {
      try {
        setFormError(null);
        await deleteCategory(id);
        if (editingId === id) cancelEdit();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Error al eliminar');
      }
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
              onClick={() => handleDelete(category.id)}
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
                      onClick={() => handleDelete(child.id)}
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
      <div className={styles['manager__header']}>
        <h1 className={styles['manager__title']}>Categorias</h1>
      </div>

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
    </div>
  );
}
