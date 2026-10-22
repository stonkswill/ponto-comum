// Gols esperados implícitos no fechamento da DraftKings (1X2 sem margem + linha principal de gols) para jogos passados.
// O cálculo fica guardado na própria entrada de odds (campo i) para não ser refeito a cada coleta.
import path from 'node:path'; import { lerJSON } from './hub.mjs';
export function implicitosDe(f, { M, K }) {
  if (!f || !(f[0] > 1 && f[1] > 1 && f[2] > 1)) return null;
  const q = K.semMargem([f[0], f[1], f[2]]).p, tot = f[3] != null && f[4] > 1 && f[5] > 1 && K.meia(f[3]) ? { linha: f[3], pOver: K.semMargem([f[4], f[5]]).p[0] } : null;
  const im = M.implicitos(q, tot, -0.03); return [Math.round(im.lh * 1000) / 1000, Math.round(im.la * 1000) / 1000];
}
/* Anexa m.ilh/m.ila. Usa (e preenche) o cache i das entradas; devolve as chaves de arquivo que mudaram. */
export function anexarImplicitos(jogos, { M, K, dados, odds = new Map() }) {
  const sujos = new Set();
  for (const m of jogos) {
    if (!m.done) continue;
    const k = m.comp + '|' + new Date(m.date).getUTCFullYear();
    if (!odds.has(k)) odds.set(k, lerJSON(path.join(dados, 'odds', k.replace('|', '-') + '.json'), {}));
    const o = odds.get(k)[m.id]; if (!o || !o.f) continue;
    if (!o.i) { const i = implicitosDe(o.f, { M, K }); if (!i) continue; o.i = i; sujos.add(k); }
    m.ilh = o.i[0]; m.ila = o.i[1];
  }
  return sujos;
}
