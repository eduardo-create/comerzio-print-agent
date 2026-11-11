// Manifiesto de actualización del agente (latest.json, publicado en cada GitHub Release).
//
// La auto-actualización baja un .exe y lo ejecuta como SYSTEM en la PC de cada cliente: es un
// canal de ejecución de código remota por diseño. Por eso no alcanza con un hash publicado al lado
// del binario — quien pudiera subir archivos al release (cuenta de GitHub comprometida, token
// filtrado) podría publicar un hash que coincida con su propio .exe. El manifiesto va firmado con
// Ed25519; la clave privada vive sólo en la PC de quien publica y la pública está embebida en el
// agente (clavePublica.js). Sin firma válida, el agente no instala nada.

const crypto = require('crypto');

const RE_VERSION = /^\d+\.\d+\.\d+$/;
const RE_SHA256 = /^[a-f0-9]{64}$/;

function compararVersiones(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] > pb[i] ? 1 : -1;
    }
  }
  return 0;
}

// Lo firmado es exactamente esto: cambiar cualquiera de los tres campos invalida la firma. La URL
// entra en la firma para que nadie pueda reapuntar un manifiesto legítimo a otro binario.
function contenidoFirmado({ version, url, sha256 }) {
  return Buffer.from(`${version}|${url}|${sha256}`, 'utf8');
}

function firmarManifiesto({ version, url, sha256 }, clavePrivadaPem) {
  const firma = crypto.sign(null, contenidoFirmado({ version, url, sha256 }), clavePrivadaPem).toString('base64');
  return { version, url, sha256, firma };
}

function verificarManifiesto(manifiesto, clavePublicaPem) {
  if (!manifiesto || typeof manifiesto !== 'object') {
    return { ok: false, motivo: 'manifiesto vacío o no es un objeto' };
  }
  const { version, url, sha256, firma } = manifiesto;
  if (typeof version !== 'string' || !RE_VERSION.test(version)) {
    return { ok: false, motivo: 'versión inválida' };
  }
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return { ok: false, motivo: 'URL inválida (tiene que ser https)' };
  }
  if (typeof sha256 !== 'string' || !RE_SHA256.test(sha256)) {
    return { ok: false, motivo: 'sha256 inválido' };
  }
  if (typeof firma !== 'string' || firma.length === 0) {
    return { ok: false, motivo: 'falta la firma' };
  }

  let valida = false;
  try {
    valida = crypto.verify(null, contenidoFirmado(manifiesto), clavePublicaPem, Buffer.from(firma, 'base64'));
  } catch {
    valida = false;
  }
  return valida ? { ok: true } : { ok: false, motivo: 'firma inválida' };
}

function necesitaActualizar(manifiesto, versionActual) {
  return compararVersiones(manifiesto.version, versionActual) > 0;
}

module.exports = {
  compararVersiones,
  firmarManifiesto,
  verificarManifiesto,
  necesitaActualizar,
};
