// Validação com dados reais, sem rede: usa dados/rede e dados/odds (coletados pelo robô). Grava dados/validacao.json.
import path from 'node:path';
import { carregarHub, lerJSON, gravarJSON, lerRede, RAIZ } from './hub.mjs';
import { anexarImplicitos } from './implicitos.mjs';

const H = carregarHub({ semRede: true }), { R, M, K, V, ctx } = H;
const DADOS = path.join(RAIZ, 'dados'), cache = new Map();
// Odds de abertura e fechamento a partir dos arquivos do robô, no formato de carregarOddsFechamento.
const desc = a => a ? { h: a[0], d: a[1], a: a[2], linha: a[3], over: a[4], under: a[5] } : null;
ctx.PCRede = Object.freeze(Object.assign({}, R, {
  async carregarOddsFechamento(m) { const k = m.comp + '-' + new Date(m.date).getUTCFullYear(); if (!cache.has(k)) cache.set(k, lerJSON(path.join(DADOS, 'odds', k + '.json'), {})); const o = cache.get(k)[m.id]; return o ? { casa: 'DraftKings', abertura: desc(o.a), fechamento: desc(o.f) } : null; }
}));
const rede = lerRede(); if (!rede) throw new Error('Sem dados/rede.');
anexarImplicitos(rede.jogos, { M, K, dados: DADOS });
const t0 = Date.now();
const rel = await V.rodar(rede.jogos, { comMercado: true, escolherParametros: process.argv.includes('--parametros'), onProgress: t => process.stdout.write('\r' + t.padEnd(60)) });
rel.publicado = true; rel.base = { jogos: rede.jogos.length, geradaEm: rede.indice.geradoEm };
console.log('\n' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
gravarJSON(path.join(DADOS, 'validacao.json'), rel, { compacto: false });
console.log(JSON.stringify({ parametros: rel.parametros, teste: rel.teste, tempos: rel.tempos, mercado: rel.mercado && { n: rel.mercado.n, logLoss: rel.mercado.logLoss, peso: rel.mercado.pesoModeloNaMistura, segundaMetade: rel.mercado.segundaMetade, regras: rel.mercado.regras, filtro: rel.mercado.filtroSugestoes } }, null, 1));
