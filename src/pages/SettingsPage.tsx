import { useState, useEffect } from 'react';
import { Save, Download, Keyboard } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import styles from './SettingsPage.module.css';

interface SettingsPageProps {
  onStoreNameChange?: (storeName: string) => void;
}

export function SettingsPage({ onStoreNameChange }: SettingsPageProps) {
  const { settings, loading, fetchSettings, saveMultiple, setCloudApiKey, hasCloudApiKey } = useSettings();

  const [form, setForm] = useState({
    store_name: '',
    store_address: '',
    store_phone: '',
    ticket_footer_text: '',
    default_credit_days: '5',
    default_surcharge_percent: '10',
    default_margin_percent: '50',
    business_timezone: 'America/Mexico_City',
    aws_enabled: '1',
    aws_env: 'prod',
    aws_region: '',
    aws_api_base_url: '',
    aws_timeout_ms: '5000',
    aws_retry_max: '2',
  });
  const [cloudApiKey, setCloudApiKeyInput] = useState('');
  const [cloudApiKeyDirty, setCloudApiKeyDirty] = useState(false);
  const [hasStoredCloudApiKey, setHasStoredCloudApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    void (async () => {
      const exists = await hasCloudApiKey();
      setHasStoredCloudApiKey(exists);
    })();
  }, [hasCloudApiKey]);

  // Sync form with loaded settings
  useEffect(() => {
    setForm({
      store_name: settings.store_name || '',
      store_address: settings.store_address || '',
      store_phone: settings.store_phone || '',
      ticket_footer_text: settings.ticket_footer_text || '',
      default_credit_days: settings.default_credit_days || '5',
      default_surcharge_percent: settings.default_surcharge_percent || '10',
      default_margin_percent: settings.default_margin_percent || '50',
      business_timezone: settings.business_timezone || 'America/Mexico_City',
      aws_enabled: settings.aws_enabled || '0',
      aws_env: settings.aws_env || 'prod',
      aws_region: settings.aws_region || '',
      aws_api_base_url: settings.aws_api_base_url || '',
      aws_timeout_ms: settings.aws_timeout_ms || '5000',
      aws_retry_max: settings.aws_retry_max || '2',
    });
  }, [settings]);

  function showNotification(type: 'success' | 'error', message: string) {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  }

  function handleChange(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Validate numeric fields
      const days = Number(form.default_credit_days);
      const surcharge = Number(form.default_surcharge_percent);
      const margin = Number(form.default_margin_percent);
      if (isNaN(days) || days < 1) {
        showNotification('error', 'Los dias de credito deben ser al menos 1');
        return;
      }
      if (isNaN(surcharge) || surcharge < 0) {
        showNotification('error', 'El porcentaje de recargo no puede ser negativo');
        return;
      }
      if (isNaN(margin) || margin < 0) {
        showNotification('error', 'El margen por defecto no puede ser negativo');
        return;
      }
      if (!form.business_timezone.trim()) {
        showNotification('error', 'La zona horaria no puede estar vacia');
        return;
      }
      if (form.aws_enabled === '1') {
        if (!form.aws_api_base_url.trim()) {
          showNotification('error', 'La URL base de API es obligatoria cuando AWS esta habilitado');
          return;
        }
        if (!form.aws_region.trim()) {
          showNotification('error', 'La region AWS es obligatoria cuando AWS esta habilitado');
          return;
        }

        const timeout = Number(form.aws_timeout_ms);
        const retries = Number(form.aws_retry_max);
        if (isNaN(timeout) || timeout < 1000) {
          showNotification('error', 'El timeout AWS debe ser de al menos 1000 ms');
          return;
        }
        if (isNaN(retries) || retries < 0 || retries > 5) {
          showNotification('error', 'Los reintentos AWS deben estar entre 0 y 5');
          return;
        }
      }

      const entries = Object.entries(form).map(([key, value]) => ({ key, value }));
      await saveMultiple(entries);
      if (cloudApiKeyDirty) {
        await setCloudApiKey(cloudApiKey);
        const exists = await hasCloudApiKey();
        setHasStoredCloudApiKey(exists);
        setCloudApiKeyInput('');
        setCloudApiKeyDirty(false);
      }
      onStoreNameChange?.(form.store_name.trim() || 'Tienda');
      showNotification('success', 'Configuracion guardada correctamente');
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleBackup() {
    setBackingUp(true);
    try {
      const result = await window.electronAPI.settings.backupDatabase();
      showNotification('success', `Respaldo creado: ${result}`);
    } catch (err) {
      showNotification('error', err instanceof Error ? err.message : 'Error al crear respaldo');
    } finally {
      setBackingUp(false);
    }
  }

  if (loading && !form.store_name) {
    return <div className={styles.page}><p>Cargando configuracion...</p></div>;
  }

  return (
    <div className={styles.page}>
      {/* Notification */}
      {notification && (
        <div className={`${styles.notification} ${notification.type === 'success' ? styles['notification--success'] : styles['notification--error']}`}>
          {notification.message}
        </div>
      )}

      <div className={styles['page__header']}>
        <h1 className={styles['page__title']}>Configuracion</h1>
        <button
          className={styles['btn-primary']}
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={16} strokeWidth={1.5} />
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>

      {/* AWS cloud connection */}
      <div className={styles.section}>
        <h2 className={styles['section__title']}>Conexion AWS</h2>
        <p className={styles['section__description']}>
          Configura la API cloud (Lambda + API Gateway). La API key se guarda cifrada localmente.
        </p>

        <div className={styles.field}>
          <label className={styles['field__label']}>Habilitar modo AWS</label>
          <select
            className={styles['field__input']}
            value={form.aws_enabled}
            onChange={e => handleChange('aws_enabled', e.target.value)}
          >
            <option value="0">No</option>
            <option value="1">Si</option>
          </select>
        </div>

        <div className={styles['field-row']}>
          <div className={styles.field}>
            <label className={styles['field__label']}>Entorno</label>
            <select
              className={styles['field__input']}
              value={form.aws_env}
              onChange={e => handleChange('aws_env', e.target.value)}
            >
              <option value="prod">prod</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles['field__label']}>Region AWS</label>
            <input
              className={styles['field__input']}
              type="text"
              value={form.aws_region}
              onChange={e => handleChange('aws_region', e.target.value)}
              placeholder="us-east-1"
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles['field__label']}>API Base URL</label>
          <input
            className={styles['field__input']}
            type="text"
            value={form.aws_api_base_url}
            onChange={e => handleChange('aws_api_base_url', e.target.value)}
            placeholder="https://xxxx.execute-api.us-east-1.amazonaws.com"
          />
        </div>

        <div className={styles['field-row']}>
          <div className={styles.field}>
            <label className={styles['field__label']}>Timeout (ms)</label>
            <input
              className={styles['field__input']}
              type="number"
              min={1000}
              value={form.aws_timeout_ms}
              onChange={e => handleChange('aws_timeout_ms', e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles['field__label']}>Reintentos maximos</label>
            <input
              className={styles['field__input']}
              type="number"
              min={0}
              max={5}
              value={form.aws_retry_max}
              onChange={e => handleChange('aws_retry_max', e.target.value)}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles['field__label']}>API Key</label>
          <input
            className={styles['field__input']}
            type="password"
            value={cloudApiKey}
            onChange={e => {
              setCloudApiKeyInput(e.target.value);
              setCloudApiKeyDirty(true);
            }}
            placeholder={hasStoredCloudApiKey ? 'API key guardada (escribe para reemplazar o deja vacio para eliminar)' : 'Pega tu API key'}
          />
          <span className={styles['field__hint']}>
            {hasStoredCloudApiKey
              ? 'Actualmente existe una API key guardada de forma cifrada local.'
              : 'No hay API key guardada.'}
          </span>
        </div>
      </div>

      {/* Store info */}
      <div className={styles.section}>
        <h2 className={styles['section__title']}>Datos de la tienda</h2>
        <p className={styles['section__description']}>
          Esta informacion aparece en los tickets de venta
        </p>

        <div className={styles.field}>
          <label className={styles['field__label']}>Nombre de la tienda</label>
          <input
            className={styles['field__input']}
            type="text"
            value={form.store_name}
            onChange={e => handleChange('store_name', e.target.value)}
            placeholder="Mi Papeleria"
          />
        </div>

        <div className={styles.field}>
          <label className={styles['field__label']}>Direccion</label>
          <input
            className={styles['field__input']}
            type="text"
            value={form.store_address}
            onChange={e => handleChange('store_address', e.target.value)}
            placeholder="Calle, Colonia, Ciudad"
          />
        </div>

        <div className={styles.field}>
          <label className={styles['field__label']}>Telefono</label>
          <input
            className={styles['field__input']}
            type="text"
            value={form.store_phone}
            onChange={e => handleChange('store_phone', e.target.value)}
            placeholder="(555) 123-4567"
          />
        </div>

        <div className={styles.field}>
          <label className={styles['field__label']}>Texto del pie de ticket</label>
          <textarea
            className={`${styles['field__input']} ${styles['field__input--textarea']}`}
            value={form.ticket_footer_text}
            onChange={e => handleChange('ticket_footer_text', e.target.value)}
            placeholder="Gracias por su compra"
            rows={2}
          />
          <span className={styles['field__hint']}>Se muestra al final de cada ticket impreso</span>
        </div>
      </div>

      {/* Products defaults */}
      <div className={styles.section}>
        <h2 className={styles['section__title']}>Productos</h2>
        <p className={styles['section__description']}>
          Valores predeterminados para nuevos productos
        </p>

        <div className={styles.field}>
          <label className={styles['field__label']}>Utilidad (margen) por defecto (%)</label>
          <input
            className={styles['field__input']}
            type="number"
            min={0}
            step={0.5}
            value={form.default_margin_percent}
            onChange={e => handleChange('default_margin_percent', e.target.value)}
          />
          <span className={styles['field__hint']}>Se aplica automáticamente al crear nuevo producto</span>
        </div>
      </div>

      {/* Credit defaults */}
      <div className={styles.section}>
        <h2 className={styles['section__title']}>Credito</h2>
        <p className={styles['section__description']}>
          Valores predeterminados para ventas a credito
        </p>

        <div className={styles['field-row']}>
          <div className={styles.field}>
            <label className={styles['field__label']}>Dias de plazo por defecto</label>
            <input
              className={styles['field__input']}
              type="number"
              min={1}
              value={form.default_credit_days}
              onChange={e => handleChange('default_credit_days', e.target.value)}
            />
            <span className={styles['field__hint']}>Dias antes de aplicar recargo</span>
          </div>

          <div className={styles.field}>
            <label className={styles['field__label']}>Porcentaje de recargo (%)</label>
            <input
              className={styles['field__input']}
              type="number"
              min={0}
              step={0.5}
              value={form.default_surcharge_percent}
              onChange={e => handleChange('default_surcharge_percent', e.target.value)}
            />
            <span className={styles['field__hint']}>Se aplica una sola vez si se pasa del plazo</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles['field__label']}>Zona horaria de negocio (IANA)</label>
          <input
            className={styles['field__input']}
            type="text"
            value={form.business_timezone}
            onChange={e => handleChange('business_timezone', e.target.value)}
            placeholder="America/Mexico_City"
          />
          <span className={styles['field__hint']}>
            Ejemplos: America/Mexico_City, America/Cancun, America/Tijuana
          </span>
        </div>
      </div>

      {/* Backup */}
      <div className={styles.section}>
        <h2 className={styles['section__title']}>Respaldo de datos</h2>
        <p className={styles['section__description']}>
          Crea una copia de la base de datos en la carpeta de respaldos
        </p>

        <div className={styles['backup__info']}>
          <div className={styles['backup__details']}>
            <span className={styles['backup__last']}>
              Se guarda en la carpeta &quot;backups&quot; junto a la base de datos
            </span>
          </div>
          <button
            className={styles['btn-secondary']}
            onClick={handleBackup}
            disabled={backingUp}
          >
            <Download size={16} strokeWidth={1.5} />
            {backingUp ? 'Creando respaldo...' : 'Crear respaldo ahora'}
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts reference */}
      <div className={styles.section}>
        <h2 className={styles['section__title']}>
          <Keyboard size={18} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Atajos de teclado (Punto de Venta)
        </h2>

        <table className={styles['shortcuts-table']}>
          <thead>
            <tr>
              <th>Atajo</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><kbd>F1</kbd></td>
              <td>Cobrar venta (efectivo)</td>
            </tr>
            <tr>
              <td><kbd>F2</kbd></td>
              <td>Enfocar busqueda de productos</td>
            </tr>
            <tr>
              <td><kbd>F3</kbd></td>
              <td>Venta a credito</td>
            </tr>
            <tr>
              <td><kbd>F4</kbd></td>
              <td>Limpiar carrito</td>
            </tr>
            <tr>
              <td><kbd>Esc</kbd></td>
              <td>Cerrar ventana / modal activo</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.version}>
        store-internal v{__APP_VERSION__} · {__APP_CREDITS__} · {__APP_REPO_URL__}
      </div>
    </div>
  );
}
