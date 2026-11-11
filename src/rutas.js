// Dónde vive cada cosa según cómo corra el agente:
//
// - Empaquetado (.exe, Node SEA, instalado como servicio): todo junto al ejecutable, en
//   C:\Program Files\Comerzio\PrintAgent\. A propósito NO en %ProgramData%: el servicio corre como
//   SYSTEM y ejecuta raw-print.ps1, y en ProgramData un usuario común puede crear carpetas — podría
//   adelantarse a crear la nuestra y dejar ahí un script propio que SYSTEM ejecutaría (escalada de
//   privilegios). Program Files sólo lo escriben administradores y SYSTEM.
// - Desarrollo (`npm start`): el script se usa directo desde src/ y los datos van a .datos/.

const fs = require('fs');
const path = require('path');

function esEjecutableEmpaquetado() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

function directorioBase() {
  return esEjecutableEmpaquetado() ? path.dirname(process.execPath) : path.join(__dirname, '..', '.datos');
}

function directorioStaging() {
  return path.join(directorioBase(), 'staging');
}

// En el .exe, raw-print.ps1 viaja como asset del SEA (powershell.exe necesita un archivo real), así
// que se reescribe en cada arranque: si una actualización cambia el script, el exe nuevo trae el suyo.
function prepararScriptImpresion() {
  if (!esEjecutableEmpaquetado()) {
    return path.join(__dirname, 'raw-print.ps1');
  }
  const destino = path.join(directorioBase(), 'raw-print.ps1');
  fs.writeFileSync(destino, require('node:sea').getAsset('raw-print.ps1', 'utf8'));
  return destino;
}

module.exports = {
  esEjecutableEmpaquetado,
  directorioBase,
  directorioStaging,
  prepararScriptImpresion,
};
