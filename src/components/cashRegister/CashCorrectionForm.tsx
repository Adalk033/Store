import { useState, type FormEvent } from 'react';
import type { CashRegisterPeriod, SaleListItem } from '../../types';
import { getBusinessTodayDate } from '../../lib/formatters';
import styles from '../../pages/CashRegisterPage.module.css';

export interface CashCorrectionSelection {
  period: CashRegisterPeriod;
  sale?: SaleListItem;
}

interface Props {
  selection: CashCorrectionSelection;
  periods: CashRegisterPeriod[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

export function CashCorrectionForm({ selection: { period, sale }, periods, onCancel, onSaved }: Props) {
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const target = periods.find(row => String(row.id) === destination);
  const today = getBusinessTodayDate();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const fields = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      if (sale && target) {
        await window.electronAPI.cashRegister.transfer({
          sale_id: sale.id, source_id: period.id, target_id: target.id,
          source_version: period.version, target_version: target.version, sale_date: String(fields.get('date')),
        });
      } else if (!sale) {
        await window.electronAPI.cashRegister.correct({
          id: period.id, version: period.version, start_date: String(fields.get('start')), end_date: String(fields.get('end')),
          opening_cash: Number(fields.get('opening')), closing_cash: Number(fields.get('closing')),
        });
      } else {
        throw new Error('Selecciona la caja de destino');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el cambio');
      setSaving(false);
      return;
    }
    await onSaved();
  }

  return <div className={styles['confirm-overlay']}>
    <form className={styles['confirm-dialog']} role="dialog" aria-modal="true" aria-labelledby="correction-title" onSubmit={submit}>
      <h3 id="correction-title">{sale ? `Mover venta #${sale.id}` : 'Editar corte'} · {period.period_name}</h3>
      {sale ? <>
        <label className={styles['form-field']}>Caja de destino
          <select required autoFocus className={styles['form-field__select']} value={destination} onChange={e => setDestination(e.target.value)}>
            <option value="">Selecciona una caja</option>
            {periods.filter(row => row.id !== period.id).map(row =>
              <option key={row.id} value={row.id}>{row.period_name} ({row.start_date} al {row.end_date || 'presente'})</option>)}
          </select>
        </label>
        <label className={styles['form-field']}>Fecha de venta en la caja destino
          <input key={destination} required name="date" type="date" disabled={!target} min={target?.start_date}
            max={target?.end_date && target.end_date < today ? target.end_date : today} className={styles['form-field__input']} />
        </label>
        {sale.sale_type === 'credit' && <p>Los abonos se conservan en la caja de cobro y el crédito conserva su vencimiento.</p>}
      </> : <>
        <label className={styles['form-field']}>Fecha de inicio<input required autoFocus className={styles['form-field__input']} name="start" type="date" defaultValue={period.start_date} /></label>
        <label className={styles['form-field']}>Fecha de cierre<input required className={styles['form-field__input']} name="end" type="date" defaultValue={period.end_date ?? ''} /></label>
        <label className={styles['form-field']}>Efectivo inicial<input required className={styles['form-field__input']} name="opening" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={period.opening_cash} /></label>
        <label className={styles['form-field']}>Efectivo contado<input required className={styles['form-field__input']} name="closing" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={period.closing_cash ?? ''} /></label>
      </>}
      {error && <p role="alert" className={styles['form-field__error']}>{error}</p>}
      <div className={styles['confirm-dialog__actions']}>
        <button type="button" disabled={saving} className={styles['btn-secondary']} onClick={onCancel}>Cancelar</button>
        <button type="submit" disabled={saving || Boolean(sale && !target)} className={styles['btn-primary']}>{sale ? 'Mover venta' : 'Guardar corte'}</button>
      </div>
    </form>
  </div>;
}
