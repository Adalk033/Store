import { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { Save, RefreshCw } from 'lucide-react';
import { generateBarcode } from '../../lib/barcode';
import { formatCurrency } from '../../lib/formatters';
import type { Product, Category } from '../../types';
import styles from './ProductForm.module.css';

interface ProductFormProps {
  product: Product | null;
  categories: Category[];
  onSubmit: (data: {
    barcode: string;
    name: string;
    description?: string | null;
    category_id?: number | null;
    cost_price: number;
    margin_percent: number;
    stock?: number;
    min_stock?: number;
  }) => Promise<void>;
  onCancel: () => void;
}

interface FormErrors {
  name?: string;
  cost_price?: string;
  margin_percent?: string;
  stock?: string;
  min_stock?: string;
}

export function ProductForm({ product, categories, onSubmit, onCancel }: ProductFormProps) {
  const isEditing = product !== null;

  const [barcode, setBarcode] = useState(product?.barcode ?? generateBarcode());
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [categoryId, setCategoryId] = useState<number | ''>(product?.category_id ?? '');
  const [costPrice, setCostPrice] = useState(product?.cost_price?.toString() ?? '');
  const [marginPercent, setMarginPercent] = useState(product?.margin_percent?.toString() ?? '30');
  const [stock, setStock] = useState(product?.stock?.toString() ?? '0');
  const [minStock, setMinStock] = useState(product?.min_stock?.toString() ?? '5');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const barcodeRef = useRef<SVGSVGElement>(null);

  // Render barcode SVG
  useEffect(() => {
    if (barcodeRef.current && barcode) {
      try {
        JsBarcode(barcodeRef.current, barcode, {
          format: 'CODE128',
          width: 1.5,
          height: 40,
          displayValue: true,
          fontSize: 12,
          margin: 5,
        });
      } catch {
        // Invalid barcode value, ignore
      }
    }
  }, [barcode]);

  // Calculated sale price preview
  const cost = parseFloat(costPrice) || 0;
  const margin = parseFloat(marginPercent) || 0;
  const calculatedPrice = Math.round(cost * (1 + margin / 100) * 100) / 100;

  function regenerateBarcode() {
    if (!isEditing) {
      setBarcode(generateBarcode());
    }
  }

  function validate(): boolean {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = 'El nombre es obligatorio';
    }
    if (!costPrice || parseFloat(costPrice) <= 0) {
      newErrors.cost_price = 'El costo debe ser mayor a 0';
    }
    if (marginPercent === '' || parseFloat(marginPercent) < 0) {
      newErrors.margin_percent = 'El margen no puede ser negativo';
    }
    if (!isEditing && (stock === '' || parseInt(stock) < 0)) {
      newErrors.stock = 'El stock no puede ser negativo';
    }
    if (minStock === '' || parseInt(minStock) < 0) {
      newErrors.min_stock = 'El stock minimo no puede ser negativo';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const data: {
        barcode: string;
        name: string;
        description?: string | null;
        category_id?: number | null;
        cost_price: number;
        margin_percent: number;
        stock?: number;
        min_stock?: number;
      } = {
        barcode,
        name: name.trim(),
        description: description.trim() || null,
        category_id: categoryId !== '' ? categoryId : null,
        cost_price: parseFloat(costPrice),
        margin_percent: parseFloat(marginPercent),
        min_stock: parseInt(minStock),
      };
      // Only include stock on create
      if (!isEditing) {
        data.stock = parseInt(stock);
      }
      await onSubmit(data);
    } catch {
      // Error handled by parent
    } finally {
      setSubmitting(false);
    }
  }

  // Root categories for subcategory parent, subcategories shown grouped
  const rootCategories = categories.filter(c => c.parent_id === null);
  const getChildren = (parentId: number) => categories.filter(c => c.parent_id === parentId);

  return (
    <div className={styles['form-card']}>
      <form className={styles.form} onSubmit={handleSubmit}>
        {/* Barcode */}
        <div className={styles['form__field']}>
          <label className={styles['form__label']}>Codigo de barras</label>
          <div className={styles['barcode-section']}>
            <span className={styles['barcode-display']}>{barcode}</span>
            {!isEditing && (
              <button type="button" className={styles['btn-ghost']} onClick={regenerateBarcode} title="Regenerar codigo">
                <RefreshCw size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
          <div className={styles['barcode-preview']}>
            <svg ref={barcodeRef} />
          </div>
        </div>

        {/* Name */}
        <div className={styles['form__field']}>
          <label className={styles['form__label']}>Nombre *</label>
          <input
            className={`${styles['form__input']} ${errors.name ? styles['form__input--error'] : ''}`}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre del producto"
          />
          {errors.name && <span className={styles['form__error']}>{errors.name}</span>}
        </div>

        {/* Description */}
        <div className={styles['form__field']}>
          <label className={styles['form__label']}>Descripcion</label>
          <textarea
            className={styles['form__textarea']}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Descripcion opcional"
          />
        </div>

        {/* Category */}
        <div className={styles['form__field']}>
          <label className={styles['form__label']}>Categoria</label>
          <select
            className={styles['form__select']}
            value={categoryId}
            onChange={e => setCategoryId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Sin categoria</option>
            {rootCategories.map(parent => {
              const children = getChildren(parent.id);
              return [
                <option key={parent.id} value={parent.id}>{parent.name}</option>,
                ...children.map(child => (
                  <option key={child.id} value={child.id}>&nbsp;&nbsp;{child.name}</option>
                )),
              ];
            })}
          </select>
        </div>

        {/* Cost + Margin */}
        <div className={styles['form__row']}>
          <div className={styles['form__field']}>
            <label className={styles['form__label']}>Precio de costo *</label>
            <input
              className={`${styles['form__input']} ${errors.cost_price ? styles['form__input--error'] : ''}`}
              type="number"
              step="0.01"
              min="0"
              value={costPrice}
              onChange={e => setCostPrice(e.target.value)}
              placeholder="0.00"
            />
            {errors.cost_price && <span className={styles['form__error']}>{errors.cost_price}</span>}
          </div>
          <div className={styles['form__field']}>
            <label className={styles['form__label']}>% de utilidad *</label>
            <input
              className={`${styles['form__input']} ${errors.margin_percent ? styles['form__input--error'] : ''}`}
              type="number"
              step="0.1"
              min="0"
              value={marginPercent}
              onChange={e => setMarginPercent(e.target.value)}
              placeholder="30"
            />
            {errors.margin_percent && <span className={styles['form__error']}>{errors.margin_percent}</span>}
          </div>
        </div>

        {/* Sale price preview */}
        <div className={styles['price-preview']}>
          <div className={styles['price-preview__label']}>Precio de venta (calculado)</div>
          <div className={styles['price-preview__value']}>{formatCurrency(calculatedPrice)}</div>
        </div>

        {/* Stock + Min stock */}
        <div className={styles['form__row']}>
          {!isEditing && (
            <div className={styles['form__field']}>
              <label className={styles['form__label']}>Stock inicial</label>
              <input
                className={`${styles['form__input']} ${errors.stock ? styles['form__input--error'] : ''}`}
                type="number"
                min="0"
                value={stock}
                onChange={e => setStock(e.target.value)}
                placeholder="0"
              />
              {errors.stock && <span className={styles['form__error']}>{errors.stock}</span>}
              <span className={styles['form__hint']}>Despues use inventario para ajustar</span>
            </div>
          )}
          <div className={styles['form__field']}>
            <label className={styles['form__label']}>Stock minimo (alerta)</label>
            <input
              className={`${styles['form__input']} ${errors.min_stock ? styles['form__input--error'] : ''}`}
              type="number"
              min="0"
              value={minStock}
              onChange={e => setMinStock(e.target.value)}
              placeholder="5"
            />
            {errors.min_stock && <span className={styles['form__error']}>{errors.min_stock}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className={styles['form__actions']}>
          <button type="submit" className={styles['btn-primary']} disabled={submitting}>
            <Save size={16} strokeWidth={1.5} />
            {isEditing ? 'Guardar cambios' : 'Crear producto'}
          </button>
          <button type="button" className={styles['btn-secondary']} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
