// Gols esperados implícitos no fechamento da DraftKings (1X2 sem margem + linha principal de gols) para jogos passados.
// O cálculo fica guardado na própria entrada de odds (campo i) para não ser refeito a cada coleta.
import fs from 'node:fs'; import path from 'node:path'; import { lerJSON } from './hub.mjs';
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

/* Versão rápida (Poisson independente, grade + refino), para dezenas de milhares de jogos. q = 1X2 sem margem; pOver = mais de 2,5 sem margem. */
const pois = (l, mx = 10) => { const p = new Float64Array(mx + 1); p[0] = Math.exp(-l); for (let k = 1; k <= mx; k++) p[k] = p[k - 1] * l / k; return p; };
function basico(lh, la) { const ph = pois(lh), pa = pois(la); let h = 0, d = 0, o = 0, c = 0; const ca = []; for (let j = 0; j <= 10; j++) { c += pa[j]; ca[j] = c; }
  for (let i = 0; i <= 10; i++) { h += ph[i] * (i > 0 ? ca[i - 1] : 0); d += ph[i] * pa[i]; } for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) if (i + j > 2.5) o += ph[i] * pa[j]; return [h, d, 1 - h - d, o]; }
export function implicitoRapido(q, pOver) {
  const erro = (T, s) => { const b = basico(T * s, T * (1 - s)); let e = (b[0] - q[0]) ** 2 + (b[1] - q[1]) ** 2 + (b[2] - q[2]) ** 2; if (pOver != null) e += (b[3] - pOver) ** 2; return e; };
  let bT = 2.6, bS = 0.55, best = Infinity; for (let T = 0.8; T <= 5.6; T += 0.2) for (let s = 0.08; s <= 0.92; s += 0.04) { const v = erro(T, s); if (v < best) { best = v; bT = T; bS = s; } }
  let dT = 0.2, dS = 0.04; for (let r = 0; r < 4; r++) { dT /= 3; dS /= 3; const cT = bT, cS = bS; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const T = cT + i * dT, s = cS + j * dS; if (T <= 0.3 || s <= 0.02 || s >= 0.98) continue; const v = erro(T, s); if (v < best) { best = v; bT = T; bS = s; } } }
  return [+(bT * bS).toFixed(3), +(bT * (1 - bS)).toFixed(3)];
}
/* Implícitos de fechamento (Pinnacle > média > Bet365) para os jogos da football-data, com cache em arquivo. */
export function implicitosFD(fd, { K, arquivo }) {
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { cache = {}; }
  let novos = 0;
  for (const m of fd) { if (cache[m.id]) continue; const f = m.odds.fech, x = f.ps.x12 || f.avg.x12 || f.b365.x12, ou = f.ps.ou25 || f.avg.ou25 || f.b365.ou25; if (!x) continue;
    cache[m.id] = implicitoRapido(K.semMargem(x).p, ou ? K.semMargem(ou).p[0] : null); novos++; }
  if (novos) { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, JSON.stringify(cache)); }
  return cache;
}
