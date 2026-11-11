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

const PUERTO = 41321;
const RAW_PRINT_SCRIPT = path.join(__dirname, 'raw-print.ps1');

function conCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

function imprimirRaw(impresora, bytes) {
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
  conCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/estado') {
    responderJson(res, 200, { ok: true, agente: 'comerzio-print-agent', version: '0.1.0' });
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

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`Agente de impresión Comerzio escuchando en http://127.0.0.1:${PUERTO}`);
});
