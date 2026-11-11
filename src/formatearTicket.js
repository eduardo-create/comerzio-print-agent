// Motor genérico de impresión de tickets: interpreta el esquema de "bloques" (contrato acordado
// con el backend, ver backend/src/utils/ticketSchema.js) y arma un único buffer ESC/POS. A
// diferencia de formatearResumenCierre.js (que arma un documento fijo, específico del cierre de
// caja), acá cualquier documento se describe como una lista de bloques y un solo renderer los
// interpreta — así un ticket de venta, un remito o lo que sea que venga después reusa el mismo
// código en vez de sumar una función formatearX() y una ruta HTTP nueva por cada tipo de
// documento.

const {
  INIT,
  NEGRITA_ON,
  NEGRITA_OFF,
  CENTRAR,
  IZQUIERDA,
  CORTE_PARCIAL,
  SALTO,
  ANCHO_DOBLE_ON,
  ANCHO_DOBLE_OFF,
  columnasDesdeAncho,
  linea,
  lineaDosColumnas,
  envolverTexto,
} = require('./escposHelpers');

// Mismo espacio de cortesía que tenía formatearResumenCierre.js (ya borrado) antes de cortar: 3
// líneas en blanco. CORTE_PARCIAL no hace avance de papel por sí solo, así que sin esto el corte
// cae encima (o a través) de la última línea impresa — riesgo real en 4 de los 5 tipos de
// documento que no lo compensaban por su cuenta. Va acá, en el renderer compartido, para que
// todo documento lo tenga gratis en vez de que cada builder deba acordarse de agregarlo.
const LINEAS_ANTES_DEL_CORTE = 3;

function formatearBloqueTexto(bloque, columnas) {
  const partes = [];
  if (bloque.centrado) { partes.push(CENTRAR); }
  if (bloque.negrita) { partes.push(NEGRITA_ON); }
  if (bloque.dobleAncho) { partes.push(ANCHO_DOBLE_ON); }

  // Con doble ancho cada caracter ocupa el doble de espacio físico: el ajuste a varias líneas
  // tiene que contar la mitad de columnas o el texto se corta contra el borde del papel antes de
  // llegar al límite que `envolverTexto` cree que tiene disponible.
  const columnasEfectivas = bloque.dobleAncho ? Math.max(Math.floor(columnas / 2), 1) : columnas;
  for (const lineaTexto of envolverTexto(bloque.contenido || '', columnasEfectivas)) {
    partes.push(linea(lineaTexto));
  }

  // Vuelve a los modos por defecto después del bloque, para no arrastrar negrita/centrado/doble
  // ancho al bloque siguiente.
  if (bloque.dobleAncho) { partes.push(ANCHO_DOBLE_OFF); }
  if (bloque.negrita) { partes.push(NEGRITA_OFF); }
  if (bloque.centrado) { partes.push(IZQUIERDA); }

  return partes;
}

function formatearBloqueSeparador(columnas) {
  return [linea('-'.repeat(columnas))];
}

function formatearBloqueClaveValor(bloque, columnas) {
  if (!Array.isArray(bloque.pares)) {
    throw new Error('formatearTicket: el bloque "clave_valor" requiere "pares" como array');
  }

  const partes = [];
  for (const par of bloque.pares) {
    const lineaPar = lineaDosColumnas(String(par.clave || ''), String(par.valor || ''), columnas);
    if (par.negrita) {
      partes.push(NEGRITA_ON, lineaPar, NEGRITA_OFF);
    } else {
      partes.push(lineaPar);
    }
  }
  return partes;
}

// Cada fila imprime el nombre (envuelto, puede ocupar varias líneas) y, debajo, una segunda línea
// con lo que venga de cantidad/precio: "  x<cantidad>" a la izquierda, el precio a la derecha.
// No asumimos que ambos campos estén siempre presentes; si ninguno vino no se imprime la segunda
// línea (evita una línea de espacios en blanco).
function formatearBloqueTabla(bloque, columnas) {
  if (!Array.isArray(bloque.filas)) {
    throw new Error('formatearTicket: el bloque "tabla" requiere "filas" como array');
  }

  const partes = [];
  for (const fila of bloque.filas) {
    for (const lineaTexto of envolverTexto(fila.nombre || '', columnas)) {
      partes.push(linea(lineaTexto));
    }

    const izquierda = fila.cantidad !== undefined ? `  x${fila.cantidad}` : '';
    const derecha = fila.precio !== undefined ? String(fila.precio) : '';
    if (izquierda || derecha) {
      partes.push(lineaDosColumnas(izquierda, derecha, columnas));
    }
  }
  return partes;
}

function formatearTicket({ ancho, bloques }) {
  if (!Array.isArray(bloques)) {
    throw new Error('formatearTicket: "bloques" debe ser un array');
  }

  const columnas = columnasDesdeAncho(ancho);
  const partes = [INIT];

  for (const bloque of bloques) {
    const tipo = bloque && bloque.tipo;
    switch (tipo) {
      case 'texto':
        partes.push(...formatearBloqueTexto(bloque, columnas));
        break;
      case 'separador':
        partes.push(...formatearBloqueSeparador(columnas));
        break;
      case 'clave_valor':
        partes.push(...formatearBloqueClaveValor(bloque, columnas));
        break;
      case 'tabla':
        partes.push(...formatearBloqueTabla(bloque, columnas));
        break;
      default:
        throw new Error(`formatearTicket: tipo de bloque desconocido "${tipo}"`);
    }
  }

  for (let i = 0; i < LINEAS_ANTES_DEL_CORTE; i++) {
    partes.push(SALTO);
  }
  partes.push(CORTE_PARCIAL);

  return Buffer.concat(partes);
}

module.exports = { formatearTicket };
