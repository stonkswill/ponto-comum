// Experimento: peso das odds de fechamento passadas no modelo. Ajuste escolhe; teste confere.
import path from 'node:path';
import { carregarHub, lerJSON, lerRede, RAIZ } from './hub.mjs';
import { anexarImplicitos } from './implicitos.mjs';
const H = carregarHub({ semRede: true }), { R, M, K, V, ctx } = H, DADOS = path.join(RAIZ, 'dados'), cache = new Map();
const desc = a => a ? { h: a[0], d: a[1], a: a[2], linha: a[3], over: a[4], under: a[5] } : null;
ctx.PCRede = Object.freeze(Object.assign({}, R, { async carregarOddsFechamento(m) { const k = m.comp + '-' + new Date(m.date).getUTCFullYear(); if (!cache.has(k)) cache.set(k, lerJSON(path.join(DADOS, 'odds', k + '.json'), {})); const o = cache.get(k)[m.id]; return o ? { abertura: desc(o.a), fechamento: desc(o.f) } : null; } }));
const rede = lerRede(), t0 = Date.now();
console.log('implícitos anexados:', anexarImplicitos(rede.jogos, { M, K, dados: DADOS }), ((Date.now() - t0) / 1000).toFixed(1) + ' s');
const comps = new Set(R.COMPS.filter(c => c.radar || c.opcional).map(c => c.id)), ultimo = rede.jogos.filter(m => m.done && comps.has(m.comp)).reduce((t, m) => Math.max(t, Date.parse(m.date)), 0);
const fim = new Date(ultimo + 864e5), corte = new Date(fim - 14 * 7 * 864e5), ini = new Date(corte - 24 * 7 * 864e5);
const pesos = (process.env.PESOS || '0,0.3,0.5,0.7,0.85').split(',').map(Number), extra = JSON.parse(process.env.EXTRA || '{}');
const porId = new Map(rede.jogos.map(m => [m.id, m]));
for (const w of pesos) {
  const cfg = Object.assign({}, M.PADRAO, extra, { mktBlend: w }), t1 = Date.now();
  const pa = await V.walkForward(rede.jogos, cfg, { de: ini.toISOString(), ate: corte.toISOString(), comps });
  let melhor = null; for (const s of [1, 1.1, 1.2, 1.3]) { const mt = V.metricas(pa, { esticar: s }), nota = mt.logLoss1x2 + mt.logLossOver25 + mt.logLossAmbas; if (!melhor || nota < melhor.nota) melhor = { s, nota, mt }; }
  const pt = await V.walkForward(rede.jogos, cfg, { de: corte.toISOString(), ate: fim.toISOString(), comps }), mt = V.metricas(pt, { esticar: melhor.s });
  const mk = await V.contraMercado(pt, porId, melhor.s);
  console.log(JSON.stringify({ w, esticar: melhor.s, ajuste: [melhor.mt.logLoss1x2, melhor.mt.logLossOver25, melhor.mt.logLossAmbas], teste: [mt.n, mt.logLoss1x2, mt.logLossOver25, mt.logLossAmbas], mercado: mk && [mk.n, mk.logLoss.modelo, mk.logLoss.mercado, mk.pesoModeloNaMistura, mk.segundaMetade.mistura], seg: ((Date.now() - t1) / 1000).toFixed(0) }));
}
