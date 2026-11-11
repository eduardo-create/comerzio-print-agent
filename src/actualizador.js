// Auto-actualización del agente instalado como servicio.
//
// Flujo: baja latest.json del último GitHub Release → verifica la firma (manifiesto.js) → si la
// versión es mayor, baja el .exe.gz, verifica el sha256, lo descomprime en staging/ → corre el exe
// nuevo con --self-test (tiene que responder exactamente la versión anunciada) → espera a que no
// haya impresiones en curso → reemplaza el ejecutable y sale con código distinto de 0 para que
// WinSW reinicie el servicio con el exe nuevo.
//
// El reemplazo aprovecha que Windows deja RENOMBRAR un .exe en ejecución aunque no deje
// sobrescribirlo: el actual pasa a .old, el nuevo ocupa su nombre, y el .old se borra en el
// arranque siguiente. Cualquier falla antes del renombrado deja todo como estaba.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { verificarManifiesto, necesitaActualizar } = require('./manifiesto');

const URL_MANIFIESTO = 'https://github.com/eduardo-create/comerzio-print-agent/releases/latest/download/latest.json';
const PRIMER_CHEQUEO_MS = 60 * 1000;
const INTERVALO_MS = 6 * 60 * 60 * 1000;
const ESPERA_MAXIMA_IMPRESIONES_MS = 2 * 60 * 1000;
// Distinto de 0 a propósito: el administrador de servicios de Windows sólo aplica las acciones de
// recuperación (<onfailure> de WinSW, "reiniciar") cuando el proceso termina con error.
const CODIGO_SALIDA_ACTUALIZADO = 3;

function log(...partes) {
  console.log(new Date().toISOString(), '[actualizador]', ...partes);
}

async function descargar(url, timeoutMs) {
  const respuesta = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'comerzio-print-agent' },
  });
  if (!respuesta.ok) {
    throw new Error(`HTTP ${respuesta.status} al descargar ${url}`);
  }
  return Buffer.from(await respuesta.arrayBuffer());
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function ejecutarAutoprueba(rutaExe) {
  return new Promise((resolve, reject) => {
    execFile(rutaExe, ['--self-test'], { timeout: 60 * 1000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`La autoprueba del exe nuevo falló: ${stderr?.trim() || error.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function reemplazarEjecutable(rutaActual, rutaNueva) {
  const rutaVieja = `${rutaActual}.old`;
  fs.rmSync(rutaVieja, { force: true });
  fs.renameSync(rutaActual, rutaVieja);
  try {
    fs.renameSync(rutaNueva, rutaActual);
  } catch (error) {
    fs.renameSync(rutaVieja, rutaActual);
    throw error;
  }
}

function borrarSinFallar(...objetivos) {
  for (const objetivo of objetivos) {
    try {
      fs.rmSync(objetivo, { recursive: true, force: true });
    } catch (error) {
      log(`no se pudo borrar ${objetivo}: ${error.message}`);
    }
  }
}

async function esperarSinImpresiones(hayImpresionesEnCurso, maxMs = ESPERA_MAXIMA_IMPRESIONES_MS) {
  const limite = Date.now() + maxMs;
  while (hayImpresionesEnCurso()) {
    if (Date.now() > limite) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return true;
}

async function buscarYAplicar({
  versionActual,
  rutaExe,
  dirStaging,
  clavePublica,
  urlManifiesto,
  hayImpresionesEnCurso,
  salir,
  autoprobar = ejecutarAutoprueba,
}) {
  const manifiesto = JSON.parse((await descargar(urlManifiesto, 30 * 1000)).toString('utf8'));

  const verificacion = verificarManifiesto(manifiesto, clavePublica);
  if (!verificacion.ok) {
    throw new Error(`Manifiesto rechazado: ${verificacion.motivo}`);
  }
  if (!necesitaActualizar(manifiesto, versionActual)) {
    return 'al-dia';
  }

  log(`versión nueva ${manifiesto.version} (instalada: ${versionActual}), descargando ${manifiesto.url}`);
  const comprimido = await descargar(manifiesto.url, 10 * 60 * 1000);
  const hash = sha256(comprimido);
  if (hash !== manifiesto.sha256) {
    throw new Error(`sha256 no coincide: esperado ${manifiesto.sha256}, descargado ${hash}`);
  }

  fs.mkdirSync(dirStaging, { recursive: true });
  const rutaNueva = path.join(dirStaging, `ComerzioPrintAgent-${manifiesto.version}.exe`);
  fs.writeFileSync(rutaNueva, zlib.gunzipSync(comprimido));

  const versionReportada = await autoprobar(rutaNueva);
  if (versionReportada !== manifiesto.version) {
    throw new Error(`la autoprueba devolvió "${versionReportada}", se esperaba ${manifiesto.version}`);
  }

  if (!(await esperarSinImpresiones(hayImpresionesEnCurso))) {
    log('hay impresiones en curso hace demasiado, se reintenta en el próximo chequeo');
    return 'ocupado';
  }

  reemplazarEjecutable(rutaExe, rutaNueva);
  log(`ejecutable reemplazado por ${manifiesto.version}, reiniciando el servicio`);
  salir(CODIGO_SALIDA_ACTUALIZADO);
  return 'actualizado';
}

function iniciarActualizador(opciones) {
  const config = { urlManifiesto: URL_MANIFIESTO, ...opciones };
  let enCurso = false;

  borrarSinFallar(`${config.rutaExe}.old`, config.dirStaging);

  const chequear = async () => {
    if (enCurso) {
      return;
    }
    enCurso = true;
    try {
      const resultado = await buscarYAplicar(config);
      if (resultado === 'al-dia') {
        log(`al día (${config.versionActual})`);
      }
    } catch (error) {
      log(`error buscando actualización: ${error.message}`);
      borrarSinFallar(config.dirStaging);
    } finally {
      enCurso = false;
    }
  };

  setTimeout(chequear, PRIMER_CHEQUEO_MS);
  setInterval(chequear, INTERVALO_MS);
}

module.exports = {
  iniciarActualizador,
  buscarYAplicar,
  reemplazarEjecutable,
  esperarSinImpresiones,
  CODIGO_SALIDA_ACTUALIZADO,
};
