const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { compararVersiones, firmarManifiesto, verificarManifiesto, necesitaActualizar } = require('../manifiesto');
const { buscarYAplicar, reemplazarEjecutable, esperarSinImpresiones } = require('../actualizador');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLICA = publicKey.export({ type: 'spki', format: 'pem' });
const PRIVADA = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SHA = 'a'.repeat(64);

describe('compararVersiones', () => {
  it('compara numéricamente, no como texto', () => {
    expect(compararVersiones('0.10.0', '0.9.0')).toBe(1);
    expect(compararVersiones('1.0.0', '1.0.0')).toBe(0);
    expect(compararVersiones('0.2.0', '0.2.1')).toBe(-1);
  });
});

describe('verificarManifiesto', () => {
  const valido = () => firmarManifiesto({ version: '0.3.0', url: 'https://x/a.exe.gz', sha256: SHA }, PRIVADA);

  it('acepta un manifiesto firmado con la clave par', () => {
    expect(verificarManifiesto(valido(), PUBLICA)).toEqual({ ok: true });
  });

  it.each([
    ['version', '9.9.9'],
    ['url', 'https://otro/malo.exe.gz'],
    ['sha256', 'b'.repeat(64)],
  ])('rechaza si se altera %s después de firmar', (campo, valor) => {
    const m = { ...valido(), [campo]: valor };
    expect(verificarManifiesto(m, PUBLICA)).toEqual({ ok: false, motivo: 'firma inválida' });
  });

  it('rechaza un manifiesto firmado con otra clave', () => {
    const otra = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
    const m = firmarManifiesto({ version: '0.3.0', url: 'https://x/a.exe.gz', sha256: SHA }, otra);
    expect(verificarManifiesto(m, PUBLICA).ok).toBe(false);
  });

  it('rechaza campos malformados y URLs http', () => {
    expect(verificarManifiesto(null, PUBLICA).ok).toBe(false);
    expect(verificarManifiesto({ ...valido(), firma: undefined }, PUBLICA).ok).toBe(false);
    expect(verificarManifiesto({ ...valido(), version: '1.0' }, PUBLICA).ok).toBe(false);
    const http = firmarManifiesto({ version: '0.3.0', url: 'http://x/a.exe.gz', sha256: SHA }, PRIVADA);
    expect(verificarManifiesto(http, PUBLICA).motivo).toMatch(/https/);
  });

  it('necesitaActualizar sólo con una versión estrictamente mayor', () => {
    expect(necesitaActualizar({ version: '0.3.0' }, '0.2.9')).toBe(true);
    expect(necesitaActualizar({ version: '0.3.0' }, '0.3.0')).toBe(false);
    expect(necesitaActualizar({ version: '0.2.0' }, '0.3.0')).toBe(false);
  });
});

describe('reemplazarEjecutable', () => {
  it('deja el nuevo en el lugar del actual y el actual como .old', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-'));
    const actual = path.join(dir, 'a.exe');
    const nuevo = path.join(dir, 'b.exe');
    fs.writeFileSync(actual, 'viejo');
    fs.writeFileSync(nuevo, 'nuevo');
    reemplazarEjecutable(actual, nuevo);
    expect(fs.readFileSync(actual, 'utf8')).toBe('nuevo');
    expect(fs.readFileSync(`${actual}.old`, 'utf8')).toBe('viejo');
  });

  it('si el nuevo no existe, restaura el actual', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-'));
    const actual = path.join(dir, 'a.exe');
    fs.writeFileSync(actual, 'viejo');
    expect(() => reemplazarEjecutable(actual, path.join(dir, 'no-existe.exe'))).toThrow();
    expect(fs.readFileSync(actual, 'utf8')).toBe('viejo');
  });
});

describe('esperarSinImpresiones', () => {
  it('se rinde si sigue ocupado pasado el máximo', async () => {
    expect(await esperarSinImpresiones(() => true, 10)).toBe(false);
    expect(await esperarSinImpresiones(() => false, 10)).toBe(true);
  });
});

// Flujo completo contra un servidor HTTP local. La autoprueba se inyecta: lee el "exe" descargado
// (un archivo de texto con la versión) en vez de ejecutarlo.
describe('buscarYAplicar', () => {
  let servidor;
  let base;
  const archivos = {};

  beforeAll(async () => {
    servidor = http.createServer((req, res) => {
      const cuerpo = archivos[req.url];
      if (!cuerpo) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end(cuerpo);
    });
    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  afterAll(() => servidor.close());

  // verificarManifiesto exige https: se firma una URL https ficticia y el fetch del test la
  // reescribe a http contra el servidor local.
  const fetchOriginal = global.fetch;
  beforeEach(() => {
    global.fetch = (url, opciones) => fetchOriginal(String(url).replace('https://', 'http://'), opciones);
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  function preparar({ versionPublicada, contenidoExe = versionPublicada, alterarHash = false, firmarCon = PRIVADA }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-'));
    const rutaExe = path.join(dir, 'ComerzioPrintAgent.exe');
    fs.writeFileSync(rutaExe, '0.2.0');
    const gz = zlib.gzipSync(Buffer.from(contenidoExe));
    archivos['/agente.gz'] = gz;
    const sha256 = alterarHash ? 'f'.repeat(64) : crypto.createHash('sha256').update(gz).digest('hex');
    const url = `${base.replace('http://', 'https://')}/agente.gz`;
    archivos['/latest.json'] = JSON.stringify(firmarManifiesto({ version: versionPublicada, url, sha256 }, firmarCon));
    return { dir, rutaExe };
  }

  function correr(rutaExe, dir, { salir = () => {}, ocupado = false } = {}) {
    return buscarYAplicar({
      versionActual: '0.2.0',
      rutaExe,
      dirStaging: path.join(dir, 'staging'),
      clavePublica: PUBLICA,
      urlManifiesto: `${base}/latest.json`,
      hayImpresionesEnCurso: () => ocupado,
      salir,
      autoprobar: async (ruta) => fs.readFileSync(ruta, 'utf8'),
    });
  }

  it('instala una versión mayor: reemplaza el exe y pide reiniciar con código 3', async () => {
    const { dir, rutaExe } = preparar({ versionPublicada: '0.3.0' });
    const salir = vi.fn();
    expect(await correr(rutaExe, dir, { salir })).toBe('actualizado');
    expect(fs.readFileSync(rutaExe, 'utf8')).toBe('0.3.0');
    expect(fs.readFileSync(`${rutaExe}.old`, 'utf8')).toBe('0.2.0');
    expect(salir).toHaveBeenCalledWith(3);
  });

  it('no hace nada si la versión publicada no es mayor', async () => {
    const { dir, rutaExe } = preparar({ versionPublicada: '0.2.0' });
    expect(await correr(rutaExe, dir)).toBe('al-dia');
  });

  it('rechaza un manifiesto firmado con otra clave y no toca el instalado', async () => {
    const otra = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
    const { dir, rutaExe } = preparar({ versionPublicada: '0.3.0', firmarCon: otra });
    await expect(correr(rutaExe, dir)).rejects.toThrow(/firma inválida/);
    expect(fs.readFileSync(rutaExe, 'utf8')).toBe('0.2.0');
  });

  it('rechaza un binario cuyo hash no coincide y no toca el instalado', async () => {
    const { dir, rutaExe } = preparar({ versionPublicada: '0.3.0', alterarHash: true });
    await expect(correr(rutaExe, dir)).rejects.toThrow(/sha256 no coincide/);
    expect(fs.readFileSync(rutaExe, 'utf8')).toBe('0.2.0');
  });

  it('rechaza un exe que no responde la versión anunciada', async () => {
    const { dir, rutaExe } = preparar({ versionPublicada: '0.3.0', contenidoExe: '0.2.5' });
    await expect(correr(rutaExe, dir)).rejects.toThrow(/autoprueba/);
    expect(fs.readFileSync(rutaExe, 'utf8')).toBe('0.2.0');
  });
});
