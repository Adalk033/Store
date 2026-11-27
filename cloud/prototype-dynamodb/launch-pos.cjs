const { app, dialog, safeStorage } = require('electron');
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { transform } = require('esbuild');

const apiId = process.env.MICHI_POC_API_ID;
const secret = process.env.MICHI_POC_API_KEY;
if (!/^[a-z0-9]{10}$/.test(apiId ?? '') || apiId === 'ytjpwo8efc' || !secret || secret.length < 32 || secret.length > 256) {
  throw new Error('Configura el ID y la clave de la API de pruebas.');
}

const projectRoot = path.resolve(__dirname, '../..');
const mainPath = path.join(projectRoot, 'dist-electron', 'main.js');
const preloadPath = path.join(projectRoot, 'dist-electron', 'preload.js');
const rendererPath = path.join(projectRoot, 'dist');
if (![mainPath, preloadPath, path.join(rendererPath, 'index.html')].every(existsSync)) {
  throw new Error('Falta compilar el POS con pnpm run build.');
}

app.setName('Michipapeleria DynamoDB - PRUEBAS');
app.enableSandbox();
const userData = mkdtempSync(path.join(tmpdir(), 'michi-pos-dynamo-'));
app.setPath('userData', userData);
delete process.env.VITE_DEV_SERVER_URL;
delete process.env.MICHI_POC_API_KEY;
const baseUrl = 'https://' + apiId + '.execute-api.mx-central-1.amazonaws.com/test';
const expected = new URL(baseUrl);

const originalFetch = globalThis.fetch;
let approvalQueue = Promise.resolve();
globalThis.fetch = (resource, options) => {
  const request = new Request(resource, options);
  const url = new URL(request.url);
  if (url.origin !== expected.origin || !url.pathname.startsWith('/test/v1/') || url.username || url.password) {
    return Promise.reject(new Error('La solicitud no tiene como destino la API de pruebas.'));
  }
  const approval = approvalQueue.then(async () => {
    const operation = request.method + ' ' + url.pathname + url.search;
    const answer = await dialog.showMessageBox({
      type: 'question',
      title: 'Autorización AWS - PRUEBAS',
      message: '¿Autorizas esta operación en la API de pruebas en México Central?',
      detail: operation + '\n\nIncluye la lectura de las cuatro tablas sintéticas y dos comprobaciones de versión. '
        + (request.method === 'GET' ? '' : 'Si cambian los datos, incluye la escritura transaccional correspondiente.'),
      buttons: ['Cancelar', 'Autorizar una vez'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1 || request.signal.aborted) throw new Error('Operación de pruebas cancelada.');
    return originalFetch(request, { redirect: 'error' });
  });
  approvalQueue = approval.catch(() => {});
  return approval;
};

app.on('browser-window-created', (_event, window) => {
  const title = 'Michipapeleria DynamoDB - PRUEBAS';
  window.setTitle(title);
  window.on('page-title-updated', event => {
    event.preventDefault();
    window.setTitle(title);
  });
});

app.whenReady().then(async () => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('El cifrado local no está disponible.');
  const testBuild = path.join(userData, 'build');
  const testElectron = path.join(testBuild, 'dist-electron');
  const entry = path.join(testElectron, 'main.mjs');
  // Sandboxed Electron preloads require CommonJS. Keep the regular build untouched.
  const preload = await transform(readFileSync(preloadPath, 'utf8'), { format: 'cjs' });
  mkdirSync(testElectron, { recursive: true });
  copyFileSync(mainPath, entry);
  writeFileSync(path.join(testElectron, 'preload.js'), preload.code);
  symlinkSync(rendererPath, path.join(testBuild, 'dist'), 'dir');
  writeFileSync(path.join(userData, 'aws-bootstrap.json'), JSON.stringify({
    aws_env: 'test',
    aws_region: 'mx-central-1',
    aws_api_base_url: baseUrl,
    aws_timeout_ms: '100000',
    aws_retry_max: '0',
  }), { mode: 0o600 });
  writeFileSync(path.join(userData, 'cloud-api-key.bin'), await safeStorage.encryptStringAsync(secret), { mode: 0o600 });
  await import(pathToFileURL(entry).href);
}).catch(() => {
  dialog.showErrorBox('POS de pruebas', 'No se pudo iniciar el entorno de pruebas aislado.');
  app.quit();
});
