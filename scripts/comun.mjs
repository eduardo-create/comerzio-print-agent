import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(RAIZ, 'dist');
export const REPO_GITHUB = 'eduardo-create/comerzio-print-agent';
export const NOMBRE_EXE = 'ComerzioPrintAgent.exe';
export const NOMBRE_EXE_GZ = 'ComerzioPrintAgent.exe.gz';
export const NOMBRE_SETUP = 'ComerzioPrintAgent-Setup.exe';

export function version() {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version;
}

export function rutaClavePrivada() {
  return process.env.COMERZIO_AGENTE_CLAVE || path.join(os.homedir(), '.comerzio', 'agente-firma.key');
}

export function urlDescarga(v, archivo) {
  return `https://github.com/${REPO_GITHUB}/releases/download/v${v}/${archivo}`;
}
