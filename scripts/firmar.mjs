// Arma dist/latest.json firmado para la versión actual de package.json. Verifica la firma contra
// la clave pública embebida antes de escribir: si la privada local no es la par de la que viaja en
// los agentes, mejor enterarse acá que con todos los clientes rechazando la actualización.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DIST, NOMBRE_EXE_GZ, RAIZ, rutaClavePrivada, urlDescarga, version } from './comun.mjs';

const require = createRequire(import.meta.url);
const { firmarManifiesto, verificarManifiesto } = require(path.join(RAIZ, 'src', 'manifiesto.js'));
const { CLAVE_PUBLICA } = require(path.join(RAIZ, 'src', 'clavePublica.js'));

const v = version();
const rutaGz = path.join(DIST, NOMBRE_EXE_GZ);
if (!fs.existsSync(rutaGz)) {
  console.error(`No existe ${rutaGz}: correr antes "npm run build".`);
  process.exit(1);
}

const rutaPrivada = rutaClavePrivada();
if (!fs.existsSync(rutaPrivada)) {
  console.error(`No existe la clave privada ${rutaPrivada} (¿falta "npm run generar-claves" o el backup?).`);
  process.exit(1);
}

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(rutaGz)).digest('hex');
const manifiesto = firmarManifiesto({ version: v, url: urlDescarga(v, NOMBRE_EXE_GZ), sha256 }, fs.readFileSync(rutaPrivada, 'utf8'));

const verificacion = verificarManifiesto(manifiesto, CLAVE_PUBLICA);
if (!verificacion.ok) {
  console.error(`La firma no verifica con la clave pública embebida (${verificacion.motivo}). ¿Clave privada equivocada?`);
  process.exit(1);
}

fs.writeFileSync(path.join(DIST, 'latest.json'), `${JSON.stringify(manifiesto, null, 2)}\n`);
console.log(`dist/latest.json firmado para ${v} (sha256 ${sha256})`);
