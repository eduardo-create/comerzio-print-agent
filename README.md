# Agente de impresión Comerzio

Servidor local (Node, sin dependencias nativas) que recibe tickets desde el frontend de Comerzio e
imprime en modo RAW (ESC/POS) a una impresora térmica ya instalada en Windows — sin pasar por
`window.print()`/CSS, así que ningún ajuste de tamaño de papel o margen del driver puede recortar
contenido. Corre sólo en loopback (`http://127.0.0.1:41321`).

Detalle completo (por qué existe, arquitectura, cómo instalarlo en la máquina de un cliente):
[docs/modules/cierre-caja/impresion-termica.md](../docs/modules/cierre-caja/impresion-termica.md)
en la raíz del repo.

## Uso

```bash
npm install
npm start
```

Requiere la impresora ya agregada como impresora de Windows (cualquier driver instalado sirve — en
modo RAW no se usa para rasterizar, sólo como cola de salida).

## Estructura

- `src/server.js` — servidor HTTP: `GET /estado`, `GET /impresoras`, `POST /imprimir` (bytes RAW ya
  armados), `POST /imprimir-cierre` (recibe un `resumen_cierre` y lo formatea antes de imprimir).
- `src/raw-print.ps1` — manda los bytes a la cola de Windows en modo RAW (Win32 `WritePrinter` vía
  PowerShell, patrón `RawPrinterHelper`, sin dependencias nativas de Node).
- `src/formatearResumenCierre.js` — arma el ticket del cierre de caja en ESC/POS.
