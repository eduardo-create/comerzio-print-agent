// Una sola vez: genera el par Ed25519 con el que se firman las actualizaciones.
//   - Privada → ~/.comerzio/agente-firma.key (o $COMERZIO_AGENTE_CLAVE). NUNCA al repo.
//   - Pública → src/clavePublica.js (sí va al repo, embebida en cada exe).
// Si la privada se pierde, los agentes instalados no aceptan más actualizaciones: habría que
// reinstalar a mano en cada PC con un exe que traiga la clave pública nueva. Hacer backup.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { rutaClavePrivada, RAIZ } from './comun.mjs';

const rutaPrivada = rutaClavePrivada();
if (fs.existsSync(rutaPrivada)) {
  console.error(`Ya existe ${rutaPrivada}. No se pisa: regenerarla deja a todos los agentes instalados sin poder actualizarse.`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const privadaPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicaPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.mkdirSync(path.dirname(rutaPrivada), { recursive: true });
fs.writeFileSync(rutaPrivada, privadaPem, { mode: 0o600 });

const modulo = `// Clave pública Ed25519 con la que el agente verifica latest.json antes de instalar una
// actualización (ver manifiesto.js). Generada por scripts/generar-claves.mjs; la privada vive sólo
// en la PC de quien publica. Cambiarla deja a los agentes ya instalados sin poder actualizarse.
const CLAVE_PUBLICA = \`${publicaPem.trim()}\`;

module.exports = { CLAVE_PUBLICA };
`;
fs.writeFileSync(path.join(RAIZ, 'src', 'clavePublica.js'), modulo);

console.log(`Clave privada: ${rutaPrivada}  ← hacer backup fuera de esta PC`);
console.log('Clave pública escrita en src/clavePublica.js (commitearla).');
