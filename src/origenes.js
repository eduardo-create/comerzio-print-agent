// Qué páginas web pueden hablarle al agente.
//
// El agente escucha en 127.0.0.1, pero eso no lo aísla del navegador: cualquier página abierta en
// la PC del cliente puede hacer fetch a http://127.0.0.1:41321. Sin este filtro, un sitio
// cualquiera podría imprimir tickets falsos con el formato de Comerzio, gastar papel o leer los
// nombres de las impresoras. El navegador manda el header Origin en todo pedido cross-origin y una
// página no puede falsificarlo, así que alcanza con compararlo contra una lista fija.
//
// Pedidos SIN Origin (curl, scripts locales) se aceptan: no vienen de una página web, y un proceso
// local ya tiene acceso directo a la impresora sin pasar por el agente.

const ORIGENES_PERMITIDOS = new Set([
  'https://app.comerzio.com.ar',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function origenPermitido(origen) {
  return origen === undefined || ORIGENES_PERMITIDOS.has(origen);
}

module.exports = { origenPermitido, ORIGENES_PERMITIDOS };
