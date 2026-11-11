// Clave pública Ed25519 con la que el agente verifica latest.json antes de instalar una
// actualización (ver manifiesto.js). Generada por scripts/generar-claves.mjs; la privada vive sólo
// en la PC de quien publica. Cambiarla deja a los agentes ya instalados sin poder actualizarse.
const CLAVE_PUBLICA = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAti5QqNdAhOJW4nFrIPr5IV/67vU8ahRMH5AsAP2QWTw=
-----END PUBLIC KEY-----`;

module.exports = { CLAVE_PUBLICA };
