const { origenPermitido } = require('../origenes');

describe('origenPermitido', () => {
  it('acepta Comerzio en producción y el dev server de Vite', () => {
    expect(origenPermitido('https://app.comerzio.com.ar')).toBe(true);
    expect(origenPermitido('http://localhost:5173')).toBe(true);
  });

  it('acepta pedidos sin Origin (no vienen de una página web)', () => {
    expect(origenPermitido(undefined)).toBe(true);
  });

  it.each([
    'https://sitio-cualquiera.com',
    'http://app.comerzio.com.ar',
    'https://app.comerzio.com.ar.evil.com',
    'https://evil.app.comerzio.com.ar',
    'null',
    '',
  ])('rechaza %s', (origen) => {
    expect(origenPermitido(origen)).toBe(false);
  });
});
