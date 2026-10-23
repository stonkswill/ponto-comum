/* Ponto Comum v3 · diario.js
 * Apuração de uma linha pelo placar (liquidar). Usado só pelo robô do repositório para conferir os palpites que ele
 * registrou antes dos jogos (ferramentas/revisar.mjs). O site não carrega este arquivo e não registra nada no aparelho.
 */
(function (G) {
  'use strict';
  const M = () => G.PCModelo;
  function liquidar(mk, j) {
    const t = mk.t;
    if (M().doPlacar(mk)) return j.hg == null ? null : M().vence(mk, j.hg, j.ag) ? 1 : 0;
    if (t === 't1' || t === 't2' || t === 'tmg') {
      if (j.h1 == null || j.hg == null) return null; const g1 = j.h1 + j.a1, g2 = j.hg + j.ag - g1;
      if (t === 'tmg') return (mk.s === '1' ? g1 > g2 : mk.s === '2' ? g2 > g1 : g1 === g2) ? 1 : 0;
      const g = t === 't1' ? g1 : g2; return (mk.s === 'o' ? g > mk.l : g < mk.l) ? 1 : 0;
    }
    if (t === 'pg') return j.pg == null ? null : j.pg === mk.s ? 1 : 0;
    const par = t.startsWith('esc') ? [j.hc, j.ac] : t.startsWith('car') ? [j.hy == null ? null : j.hy + (j.hr || 0), j.ay == null ? null : j.ay + (j.ar || 0)] : null;
    if (!par || par[0] == null || par[1] == null) return null;
    const v = t === 'esc' || t === 'car' ? par[0] + par[1] : mk.s[0] === 'h' ? par[0] : par[1], over = t === 'esc' || t === 'car' ? mk.s === 'o' : mk.s[1] === 'o';
    return (over ? v > mk.l : v < mk.l) ? 1 : 0;
  }
  G.PCDiario = Object.freeze({ liquidar });
})(typeof globalThis !== 'undefined' ? globalThis : window);
