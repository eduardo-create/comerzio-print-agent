// Piezas ESC/POS y utilidades de texto compartidas entre documentos impresos por el agente local.
// Extraídas (copiadas tal cual, misma lógica) desde formatearResumenCierre.js, el formateador
// específico de cierre de caja que este archivo reemplazó — ya borrado, server.js ahora arma todo
// documento vía formatearTicket.js (el motor genérico de tickets), único consumidor de este
// archivo.

const ESC = 0x1B;
const GS = 0x1D;

const INIT = Buffer.from([ESC, 0x40]);
const NEGRITA_ON = Buffer.from([ESC, 0x45, 1]);
const NEGRITA_OFF = Buffer.from([ESC, 0x45, 0]);
const CENTRAR = Buffer.from([ESC, 0x61, 1]);
const IZQUIERDA = Buffer.from([ESC, 0x61, 0]);
const CORTE_PARCIAL = Buffer.from([GS, 0x56, 1]);
const SALTO = Buffer.from('\n', 'ascii');

// GS ! n -- tamaño de caracter. El byte empaqueta alto (bits 0-2) y ancho (bits 4-6) como
// multiplicador - 1. 0x10 = ancho x2, alto x1 (doble ancho sin doble alto, para no duplicar
// también la cantidad de líneas que ocupa el encabezado). 0x00 vuelve al tamaño normal. La
// impresora centra/justifica sobre el tamaño ya escalado por su cuenta -- CENTRAR no necesita
// ningún ajuste extra para que el doble ancho quede centrado.
const ANCHO_DOBLE_ON = Buffer.from([GS, 0x21, 0x10]);
const ANCHO_DOBLE_OFF = Buffer.from([GS, 0x21, 0x00]);

const ANCHO_A_COLUMNAS = { '58mm': 32, '80mm': 48 };

function columnasDesdeAncho(ancho) {
  return ANCHO_A_COLUMNAS[ancho] || ANCHO_A_COLUMNAS['58mm'];
}

// La mayoría de las térmicas baratas (como la XP-58IIH) traen activa por defecto una code page
// que no cubre acentos/ñ en UTF-8 ni en ASCII puro — mandarlos tal cual imprime bytes basura. En
// vez de negociar una code page específica por modelo (frágil, cada impresora trae la suya),
// sacamos los acentos: "María" -> "Maria", legible siempre, sin depender de qué impresora sea.
// Rango Unicode "Combining Diacritical Marks" (U+0300 a U+036F), construido desde los códigos de
// caracter a propósito en vez de un literal en el archivo, para no depender de que el editor
// preserve bien caracteres combinantes invisibles dentro de una regex.
const RANGO_DIACRITICOS_DESDE = String.fromCharCode(0x0300);
const RANGO_DIACRITICOS_HASTA = String.fromCharCode(0x036f);
const RANGO_DIACRITICOS = new RegExp('[' + RANGO_DIACRITICOS_DESDE + '-' + RANGO_DIACRITICOS_HASTA + ']', 'g');

// Red de seguridad final: cualquier caracter que no sea ASCII imprimible (0x20-0x7E) se
// reemplaza por un espacio — encontramos en la práctica que `toLocaleString('es-AR', ...)` mete
// un espacio angosto sin separar (U+00A0) entre "a." y "m." en las horas ("10:00 a. m."), que sin
// esto llega crudo como el byte 0xA0 e imprime lo que sea que esa code page tenga ahí, no un
// espacio.
const FUERA_DE_ASCII_IMPRIMIBLE = new RegExp('[^ -~]', 'g');

function quitarAcentos(texto) {
  return String(texto).normalize('NFD').replace(RANGO_DIACRITICOS, '').replace(FUERA_DE_ASCII_IMPRIMIBLE, ' ');
}

function linea(texto = '') {
  return Buffer.concat([Buffer.from(quitarAcentos(texto), 'ascii'), SALTO]);
}

// Label a la izquierda, valor a la derecha, separados para completar el ancho de la impresora
// (mismo propósito que `justify-between` en la vista HTML, pero acá hay que hacerlo a mano porque
// no existe flexbox en modo RAW).
function lineaDosColumnas(izquierda, derecha, columnas) {
  const espacioDisponible = columnas - derecha.length;
  const izquierdaRecortada = izquierda.length > espacioDisponible - 1
    ? izquierda.slice(0, Math.max(espacioDisponible - 1, 0))
    : izquierda;
  const espacios = Math.max(columnas - izquierdaRecortada.length - derecha.length, 1);
  return linea(izquierdaRecortada + ' '.repeat(espacios) + derecha);
}

function tituloSeccion(texto) {
  return Buffer.concat([NEGRITA_ON, linea(texto), NEGRITA_OFF]);
}

// Nueva (no existía en formatearResumenCierre.js, que nunca tuvo textos largos): parte `texto` en
// líneas de máximo `columnas` caracteres, cortando por espacios cuando se puede. Sólo hace corte
// duro (en cualquier posición) cuando una palabra sola ya excede `columnas`. Aplica quitarAcentos
// internamente antes de partir, así el largo que se mide es el que realmente se va a imprimir.
function envolverTexto(texto, columnas) {
  const limpio = quitarAcentos(texto);
  const palabras = limpio.split(' ').filter((palabra) => palabra.length > 0);
  if (palabras.length === 0) {
    return [''];
  }

  const lineas = [];
  let actual = '';

  for (const palabra of palabras) {
    let pendiente = palabra;

    // Corte duro: la palabra sola ya excede el ancho de columna, no hay espacio donde partir.
    while (pendiente.length > columnas) {
      if (actual.length > 0) {
        lineas.push(actual);
        actual = '';
      }
      lineas.push(pendiente.slice(0, columnas));
      pendiente = pendiente.slice(columnas);
    }

    const candidata = actual.length === 0 ? pendiente : `${actual} ${pendiente}`;
    if (candidata.length > columnas) {
      lineas.push(actual);
      actual = pendiente;
    } else {
      actual = candidata;
    }
  }

  if (actual.length > 0) {
    lineas.push(actual);
  }

  return lineas;
}

// Copias mínimas de frontend/src/lib/formato.js — el print-agent es un proceso Node aparte, sin
// acceso a los módulos del frontend (y no vale la pena un paquete compartido para dos funciones).
function formatearMoneda(valor) {
  const numero = parseFloat(valor) || 0;
  return `$ ${numero.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatearFechaHora(fecha) {
  if (!fecha) { return '-'; }
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) { return '-'; }
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

module.exports = {
  ESC,
  GS,
  INIT,
  NEGRITA_ON,
  NEGRITA_OFF,
  CENTRAR,
  IZQUIERDA,
  CORTE_PARCIAL,
  SALTO,
  ANCHO_DOBLE_ON,
  ANCHO_DOBLE_OFF,
  ANCHO_A_COLUMNAS,
  columnasDesdeAncho,
  linea,
  lineaDosColumnas,
  tituloSeccion,
  quitarAcentos,
  envolverTexto,
  formatearMoneda,
  formatearFechaHora,
};
