# Agente de impresión Comerzio

Servidor local que recibe tickets desde el frontend de Comerzio e imprime en modo RAW (ESC/POS) a
una impresora térmica ya instalada en Windows — sin pasar por `window.print()`/CSS, así que ningún
ajuste de tamaño de papel o margen del driver puede recortar contenido. Corre sólo en loopback
(`http://127.0.0.1:41321`).

Por qué existe y cómo se integra con Comerzio: `docs/modules/cierre-caja/impresion-termica.md` en
el repo de Comerzio.

## Instalar en la PC de un cliente

1. La impresora térmica tiene que estar agregada como impresora de Windows (cualquier driver sirve,
   incluso "Generic / Text Only": en modo RAW sólo se usa como cola de salida).
2. Bajar y correr
   [`ComerzioPrintAgent-Setup.exe`](https://github.com/eduardo-create/comerzio-print-agent/releases/latest/download/ComerzioPrintAgent-Setup.exe)
   (pide administrador; SmartScreen avisa porque el exe no tiene firma de código → "Más
   información" → "Ejecutar de todas formas").
3. Listo: queda como servicio de Windows (`ComerzioPrintAgent`), arranca con la PC aunque nadie
   inicie sesión y se actualiza solo.

Si en esa PC había un agente corriendo a mano (`npm start` en una consola), cerrarlo **antes** de
instalar: si no, el puerto 41321 queda ocupado y el servicio no levanta (lo dice en el log).

- Archivos: `C:\Program Files\Comerzio\PrintAgent\`
- Logs: `C:\Program Files\Comerzio\PrintAgent\logs\`
- Estado: `sc query ComerzioPrintAgent` o abrir `http://127.0.0.1:41321/estado` (devuelve la versión)
- Desinstalar: "Agregar o quitar programas" → "Comerzio - Agente de impresion"

Limitación: el servicio corre como LocalSystem, que ve las impresoras locales (USB) pero no las
compartidas de red mapeadas por usuario (`\\pc\impresora`).

## Auto-actualización

**1 minuto después de arrancar y después cada 6 horas**, el agente consulta
`releases/latest/download/latest.json` de este repo. Si hay una versión mayor:

1. verifica la firma Ed25519 del manifiesto contra la clave pública embebida (`src/clavePublica.js`);
2. baja `ComerzioPrintAgent.exe.gz` y verifica su sha256;
3. corre el exe nuevo con `--self-test` (tiene que responder exactamente la versión anunciada);
4. espera a que no haya impresiones en curso;
5. renombra el exe actual a `.old`, pone el nuevo en su lugar y sale con código 3 → WinSW reinicia el
   servicio con el exe nuevo, que borra el `.old` al arrancar.

Cualquier falla antes del paso 5 deja la versión instalada intacta (queda en el log). No hay
rollback automático si una versión arranca bien y falla después: se corrige publicando otra.

## Publicar una versión

Requisitos de una sola vez: Inno Setup 6, GitHub CLI (`gh auth login`) y la clave privada de
firma en `~/.comerzio/agente-firma.key` (o `COMERZIO_AGENTE_CLAVE`).

```bash
npm version patch     # sube la versión y crea el commit + tag
npm run build         # dist/ComerzioPrintAgent.exe, .exe.gz y -Setup.exe
npm run firmar        # dist/latest.json firmado
npm run publicar      # push + GitHub Release marcado como Latest
```

La versión de Node embebida es la de la PC que corre el build.

**La clave privada es irreemplazable**: si se pierde, los agentes instalados rechazan toda
actualización nueva y hay que reinstalar a mano en cada PC. Tenerla respaldada fuera de la PC.
`npm run generar-claves` se corre una sola vez y se niega a pisar una clave existente.

## Desarrollo

```bash
npm install
npm start          # servidor en 127.0.0.1:41321, sin auto-actualización
npm run test:run
```

## Estructura

- `src/server.js` — servidor HTTP: `GET /estado`, `GET /impresoras`, `POST /imprimir` (bytes RAW ya
  armados), `POST /imprimir-ticket` (esquema genérico de bloques, lo formatea `formatearTicket.js`).
- `src/raw-print.ps1` — manda los bytes a la cola de Windows en modo RAW (Win32 `WritePrinter` vía
  PowerShell, sin dependencias nativas de Node). En el exe viaja como asset del SEA.
- `src/formatearTicket.js` + `src/escposHelpers.js` — arman el ticket en ESC/POS.
- `src/actualizador.js`, `src/manifiesto.js`, `src/clavePublica.js` — auto-actualización firmada.
- `src/rutas.js` — dónde vive cada cosa en el exe (junto a él, en Program Files) y en desarrollo.
- `scripts/` — build (esbuild → Node SEA → Inno Setup), firma y publicación.
- `build/` — config del servicio (WinSW) e instalador (Inno Setup).
