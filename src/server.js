// Agente local de impresión de Comerzio. Corre en la máquina donde está conectada la
// impresora térmica, escucha sólo en loopback y le manda tickets en modo RAW (ESC/POS) a una
// impresora ya instalada en Windows — sin pasar por window.print()/CSS, así que ningún ajuste
// de tamaño de papel o margen del driver puede recortar contenido (ver print-agent/src/raw-print.ps1
// para el porqué). No depende de ningún paquete nativo (node-gyp): usa sólo el spooler de
// impresión de Windows vía un script de PowerShell.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { formatearTicket } = require('./formatearTicket');
const { version: VERSION } = require('../package.json');
const rutas = require('./rutas');
const { iniciarActualizador } = require('./actualizador');
const { CLAVE_PUBLICA } = require('./clavePublica');
const { origenPermitido } = require('./origenes');

const PUERTO = 41321;

// --version / --self-test: los usa el actualizador para validar un exe recién descargado antes de
// reemplazar el instalado — tiene que arrancar, cargar todos los módulos (ya cargados arriba) y
// leer su propio asset, sin levantar el servidor (el puerto lo tiene ocupado la versión vieja).
if (process.argv.includes('--version') || process.argv.includes('--self-test')) {
  if (process.argv.includes('--self-test') && rutas.esEjecutableEmpaquetado()) {
    require('node:sea').getAsset('raw-print.ps1', 'utf8');
  }
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

fs.mkdirSync(rutas.directorioBase(), { recursive: true });
const RAW_PRINT_SCRIPT = rutas.prepararScriptImpresion();

// Impresiones en curso: el actualizador espera a que llegue a 0 antes de reiniciar el servicio,
// para no cortar un ticket a la mitad.
let impresionesEnCurso = 0;

function conCors(req, res) {
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function responderJson(res, status, cuerpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (chunk) => {
      datos += chunk;
      if (datos.length > 5 * 1024 * 1024) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(datos));
    req.on('error', reject);
  });
}

async function imprimirRaw(impresora, bytes) {
  impresionesEnCurso++;
  try {
    return await enviarAImpresora(impresora, bytes);
  } finally {
    impresionesEnCurso--;
  }
}

function enviarAImpresora(impresora, bytes) {
  return new Promise((resolve, reject) => {
    const archivoTemporal = path.join(os.tmpdir(), `comerzio-ticket-${crypto.randomUUID()}.bin`);
    fs.writeFile(archivoTemporal, bytes, (errEscritura) => {
      if (errEscritura) {
        reject(errEscritura);
        return;
      }

      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RAW_PRINT_SCRIPT, '-PrinterName', impresora, '-FilePath', archivoTemporal],
        (errEjecucion, stdout, stderr) => {
          fs.unlink(archivoTemporal, () => {});
          if (errEjecucion) {
            reject(new Error(stderr?.trim() || errEjecucion.message));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });
  });
}

const servidor = http.createServer(async (req, res) => {
  // Antes que nada (incluido el preflight OPTIONS): una página de otro dominio no recibe ni los
  // headers CORS, así que el navegador tampoco le deja leer la respuesta.
  if (!origenPermitido(req.headers.origin)) {
    responderJson(res, 403, { ok: false, error: 'Origen no permitido' });
    return;
  }

  conCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/estado') {
    responderJson(res, 200, { ok: true, agente: 'comerzio-print-agent', version: VERSION });
    return;
  }

  if (req.method === 'GET' && req.url === '/impresoras') {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'],
      (error, stdout) => {
        if (error) {
          responderJson(res, 500, { ok: false, error: error.message });
          return;
        }
        const impresoras = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        responderJson(res, 200, { ok: true, impresoras });
      }
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/imprimir') {
    let cuerpo;
    try {
      cuerpo = JSON.parse(await leerCuerpo(req));
    } catch {
      responderJson(res, 400, { ok: false, error: 'Cuerpo inválido, se espera JSON' });
      return;
    }

    const { impresora, datos } = cuerpo;
    if (!impresora || !datos) {
      responderJson(res, 400, { ok: false, error: 'Faltan los campos "impresora" y/o "datos"' });
      return;
    }

    let bytes;
    try {
      bytes = Buffer.from(datos, 'base64');
    } catch {
      responderJson(res, 400, { ok: false, error: '"datos" debe venir en base64' });
      return;
    }

    try {
      await imprimirRaw(impresora, bytes);
      responderJson(res, 200, { ok: true });
    } catch (error) {
      responderJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  // Ruta genérica: el backend arma el documento como bloques del esquema genérico (ver
  // backend/src/utils/ticketSchema.js) — cierre de caja, y más adelante ticket de venta, remito,
  // etc. — y acá sólo se interpreta ese esquema con formatearTicket, un único renderer para
  // cualquier tipo de documento en vez de una ruta HTTP por tipo.
  if (req.method === 'POST' && req.url === '/imprimir-ticket') {
    let cuerpo;
    try {
      cuerpo = JSON.parse(await leerCuerpo(req));
    } catch {
      responderJson(res, 400, { ok: false, error: 'Cuerpo inválido, se espera JSON' });
      return;
    }

    const { impresora, ticket } = cuerpo;
    if (!impresora || !ticket) {
      responderJson(res, 400, { ok: false, error: 'Faltan los campos "impresora" y/o "ticket"' });
      return;
    }

    let bytes;
    try {
      bytes = formatearTicket(ticket);
    } catch (error) {
      responderJson(res, 400, { ok: false, error: `No se pudo formatear el ticket: ${error.message}` });
      return;
    }

    try {
      await imprimirRaw(impresora, bytes);
      responderJson(res, 200, { ok: true });
    } catch (error) {
      responderJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  responderJson(res, 404, { ok: false, error: 'No encontrado' });
});

servidor.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${PUERTO} ya está en uso: ¿quedó corriendo otro agente (por ejemplo un "npm start" viejo)?`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(new Date().toISOString(), `Agente de impresión Comerzio ${VERSION} escuchando en http://127.0.0.1:${PUERTO}`);

  // Sólo el .exe instalado se actualiza solo: en desarrollo (`npm start`) process.execPath es el
  // node.exe del sistema y reemplazarlo sería un desastre.
  if (rutas.esEjecutableEmpaquetado()) {
    iniciarActualizador({
      versionActual: VERSION,
      rutaExe: process.execPath,
      dirStaging: rutas.directorioStaging(),
      clavePublica: CLAVE_PUBLICA,
      hayImpresionesEnCurso: () => impresionesEnCurso > 0,
      salir: (codigo) => setTimeout(() => process.exit(codigo), 200),
    });
  }
});
