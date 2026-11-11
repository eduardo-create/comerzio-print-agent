// Build completo del agente:
//   1. esbuild: src/server.js + dependencias → un único .cjs (SEA sólo ejecuta un script, sin require de archivos)
//   2. Node SEA: blob con el script + raw-print.ps1 como asset, inyectado en una copia de node.exe
//   3. dist/ComerzioPrintAgent.exe.gz (lo que baja la auto-actualización: ~3x más chico)
//   4. Inno Setup → dist/ComerzioPrintAgent-Setup.exe (si ISCC está instalado)
//
// El exe usa el node.exe con el que se corre este script (process.execPath): la versión de Node
// del agente es la de la PC que publica.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { inject } from 'postject';
import { DIST, NOMBRE_EXE, NOMBRE_EXE_GZ, NOMBRE_SETUP, RAIZ, version } from './comun.mjs';

const WINSW_URL = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe';
// WinSW 2.x no viene firmado: se fija el hash de la descarga original para que un binario
// cambiado en el origen no termine instalado como servicio en las PCs de los clientes.
const WINSW_SHA256 = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da';
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const v = version();
const TMP = path.join(DIST, '.build');
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

console.log(`→ Build del agente ${v} con Node ${process.version}`);

// 1. Bundle
const rutaBundle = path.join(TMP, 'agente.cjs');
await esbuild.build({
  entryPoints: [path.join(RAIZ, 'src', 'server.js')],
  bundle: true,
  platform: 'node',
  target: `node${process.versions.node.split('.')[0]}`,
  format: 'cjs',
  outfile: rutaBundle,
  logLevel: 'warning',
});

// 2. SEA
const rutaBlob = path.join(TMP, 'sea-prep.blob');
const rutaConfig = path.join(TMP, 'sea-config.json');
fs.writeFileSync(rutaConfig, JSON.stringify({
  main: rutaBundle,
  output: rutaBlob,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  useSnapshot: false,
  assets: { 'raw-print.ps1': path.join(RAIZ, 'src', 'raw-print.ps1') },
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', rutaConfig], { stdio: 'inherit' });

const rutaExe = path.join(DIST, NOMBRE_EXE);
fs.copyFileSync(process.execPath, rutaExe);
await inject(rutaExe, 'NODE_SEA_BLOB', fs.readFileSync(rutaBlob), { sentinelFuse: SEA_FUSE });

const versionExe = execFileSync(rutaExe, ['--self-test'], { encoding: 'utf8' }).trim();
if (versionExe !== v) {
  throw new Error(`El exe armado responde "${versionExe}" a --self-test, se esperaba ${v}`);
}
console.log(`✓ ${NOMBRE_EXE} (autoprueba OK: ${versionExe})`);

// 3. gzip para la auto-actualización
fs.writeFileSync(path.join(DIST, NOMBRE_EXE_GZ), zlib.gzipSync(fs.readFileSync(rutaExe), { level: 9 }));
console.log(`✓ ${NOMBRE_EXE_GZ}`);

// 4. Instalador
const rutaWinsw = path.join(RAIZ, 'build', 'vendor', 'WinSW-x64.exe');
if (!fs.existsSync(rutaWinsw) || sha256(fs.readFileSync(rutaWinsw)) !== WINSW_SHA256) {
  console.log('→ Descargando WinSW 2.12.0');
  const respuesta = await fetch(WINSW_URL);
  if (!respuesta.ok) {
    throw new Error(`HTTP ${respuesta.status} bajando WinSW`);
  }
  const binario = Buffer.from(await respuesta.arrayBuffer());
  if (sha256(binario) !== WINSW_SHA256) {
    throw new Error('El WinSW descargado no coincide con el hash fijado: no se usa.');
  }
  fs.mkdirSync(path.dirname(rutaWinsw), { recursive: true });
  fs.writeFileSync(rutaWinsw, binario);
}

const candidatosIscc = [
  process.env.ISCC,
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
].filter(Boolean);
const iscc = candidatosIscc.find((ruta) => fs.existsSync(ruta));
if (!iscc) {
  console.warn(`⚠ No se encontró Inno Setup 6 (ISCC.exe): no se armó ${NOMBRE_SETUP}. Instalarlo o definir ISCC.`);
} else {
  execFileSync(iscc, ['/Q', `/DAppVersion=${v}`, path.join(RAIZ, 'build', 'instalador.iss')], { stdio: 'inherit' });
  console.log(`✓ ${NOMBRE_SETUP}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
