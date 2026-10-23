// Backtest financeiro do hub com a base da football-data.co.uk (8 ligas, várias temporadas, odds de várias casas).
// Uso: node ferramentas/backtest.mjs [--variantes]  → grava dados/backtest.json
// - Previsões semana a semana (o modelo só vê jogos anteriores).
// - Apostas em 1X2, dupla chance (odd sintética das duas odds de 1X2) e mais/menos 2,5 gols, nas odds reais de cada momento.
// - Regras escolhidas no TREINO (temporadas até 2023/24) e conferidas no TESTE (2024/25 em diante).
import fs from 'node:fs'; import path from 'node:path';
import { carregarHub, gravarJSON, RAIZ } from './hub.mjs';
import { carregarFD } from './fd.mjs';

const { M, K, V } = carregarHub({ semRede: true });
const DADOS = path.join(RAIZ, 'dados'), CACHE = path.join(RAIZ, '.cache'); fs.mkdirSync(CACHE, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const INICIO_PREV = '2020-08-01', INICIO_TESTE = '2024-07-01';
const { jogos, xg } = carregarFD(); log('football-data:', jogos.length, 'jogos;', xg, 'com xG do Understat');
if (!jogos.length) throw new Error('Sem dados/externo/fd. Rode o robô de fontes externas.');

// ---------- gols esperados implícitos no fechamento (Pinnacle; senão média; senão Bet365) para o alvo do modelo ----------
const pois = (l, mx = 10) => { const p = new Float64Array(mx + 1); p[0] = Math.exp(-l); for (let k = 1; k <= mx; k++) p[k] = p[k - 1] * l / k; return p; };
function basicoRapido(lh, la) { const ph = pois(lh), pa = pois(la); let h = 0, d = 0, o25 = 0, cumA = 0; const ca = []; for (let j = 0; j <= 10; j++) { cumA += pa[j]; ca[j] = cumA; }
  for (let i = 0; i <= 10; i++) { h += ph[i] * (i > 0 ? ca[i - 1] : 0); d += ph[i] * pa[i]; } for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) if (i + j > 2.5) o25 += ph[i] * pa[j]; return [h, d, 1 - h - d, o25]; }
function implicitoRapido(q, pOver) {
  const erro = (T, s) => { const b = basicoRapido(T * s, T * (1 - s)); let e = (b[0] - q[0]) ** 2 + (b[1] - q[1]) ** 2 + (b[2] - q[2]) ** 2; if (pOver != null) e += (b[3] - pOver) ** 2; return e; };
  let bT = 2.6, bS = 0.55, best = Infinity; for (let T = 0.8; T <= 5.6; T += 0.2) for (let s = 0.08; s <= 0.92; s += 0.04) { const v = erro(T, s); if (v < best) { best = v; bT = T; bS = s; } }
  let dT = 0.2, dS = 0.04; for (let r = 0; r < 4; r++) { dT /= 3; dS /= 3; const cT = bT, cS = bS; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const T = cT + i * dT, s = cS + j * dS; if (T <= 0.3 || s <= 0.02 || s >= 0.98) continue; const v = erro(T, s); if (v < best) { best = v; bT = T; bS = s; } } }
  return [bT * bS, bT * (1 - bS)];
}
const arqImp = path.join(CACHE, 'implicitos-fd.json'), cacheImp = fs.existsSync(arqImp) ? JSON.parse(fs.readFileSync(arqImp, 'utf8')) : {};
let novos = 0;
for (const m of jogos) {
  if (cacheImp[m.id]) { [m.ilh, m.ila] = cacheImp[m.id]; continue; }
  const f = m.odds.fech, x = (f.ps.x12 || f.avg.x12 || f.b365.x12), ou = (f.ps.ou25 || f.avg.ou25 || f.b365.ou25); if (!x) continue;
  const q = K.semMargem(x).p, po = ou ? K.semMargem(ou).p[0] : null, im = implicitoRapido(q, po); m.ilh = +im[0].toFixed(3); m.ila = +im[1].toFixed(3); cacheImp[m.id] = [m.ilh, m.ila]; novos++;
}
if (novos) fs.writeFileSync(arqImp, JSON.stringify(cacheImp)); log('implícitos:', Object.keys(cacheImp).length, '(' + novos + ' novos)');

// ---------- previsões semana a semana (com cache por variante) ----------
const comps = new Set(jogos.map(m => m.comp)), fim = new Date(Date.parse(jogos[jogos.length - 1].date) + 864e5).toISOString();
async function previsoes(nome, cfg) {
  const arq = path.join(CACHE, 'prev-' + nome + '.json'); if (fs.existsSync(arq)) return JSON.parse(fs.readFileSync(arq, 'utf8'));
  const t0 = Date.now(); const p = await V.walkForward(jogos, Object.assign({}, M.PADRAO, cfg), { de: INICIO_PREV, ate: fim, comps, onProgress: t => { if (/0 ajustes$/.test(t)) process.stdout.write('\r  ' + nome + ' ' + t + '   '); } });
  fs.writeFileSync(arq, JSON.stringify(p)); log('\n  ' + nome + ':', p.length, 'previsões em', ((Date.now() - t0) / 1000).toFixed(0), 's'); return p;
}

// ---------- mercado e apostas candidatas ----------
const porId = new Map(jogos.map(m => [m.id, m]));
const lam = (x, s) => { const m0 = (x.eh + x.ea) / 2; return [Math.exp(m0 + s * (x.eh - m0)), Math.exp(m0 + s * (x.ea - m0))]; };
const devig = x => x ? K.semMargem(x).p : null;
/* Para cada jogo: probabilidades do modelo e as linhas apostáveis com odds de cada fonte e momento. */
function montar(preds, esticar = 1.2) {
  const out = [];
  for (const x of preds) {
    const m = porId.get(x.id); if (!m) continue; const [lh, la] = lam(x, esticar), Mx = M.matriz(lh, la, x.rho, 10);
    const pm = { h: M.prob(Mx, { t: '1x2', s: 'h' }), d: M.prob(Mx, { t: '1x2', s: 'd' }), a: M.prob(Mx, { t: '1x2', s: 'a' }), o: M.prob(Mx, { t: 'tot', s: 'o', l: 2.5 }) };
    const r = m.hg > m.ag ? 'h' : m.hg === m.ag ? 'd' : 'a', tg = m.hg + m.ag;
    out.push({ m, x, pm, r, tg, temporada: m.temporada, teste: m.date >= INICIO_TESTE });
  }
  return out;
}
/* Linhas de um jogo numa fonte/momento: {mk, pm, pk (mercado sem margem da mesma casa), pin (Pinnacle fechamento sem margem), odd, y} */
function linhas(j, fonte, momento, ref = 'b365') {
  const o = j.m.odds[momento][fonte], R0 = j.m.odds[momento][ref] || {}, P = j.m.odds[momento].ps.x12 ? j.m.odds[momento].ps : j.m.odds[momento].avg; // Pinnacle do MESMO momento (sem olhar o futuro)
  const out = []; if (!o) return out;
  const q = devig(R0.x12), qp = devig(P && P.x12), qo = devig(R0.ou25), qpo = devig(P && P.ou25), pm = j.pm, BF = j.m.odds[momento].bfe || {}, qb = devig(BF.x12), qbo = devig(BF.ou25);
  if (o.x12) {
    const S = ['h', 'd', 'a'];
    S.forEach((s, i) => out.push({ t: '1x2', s, pm: pm[s], pk: q ? q[i] : null, pin: qp ? qp[i] : null, bfe: qb ? qb[i] : null, odd: o.x12[i], y: j.r === s ? 1 : 0 }));
    for (const [s, a, b] of [['1x', 0, 1], ['x2', 2, 1], ['12', 0, 2]]) out.push({ t: 'dc', s, pm: pm[S[a]] + pm[S[b]], pk: q ? q[a] + q[b] : null, pin: qp ? qp[a] + qp[b] : null, bfe: qb ? qb[a] + qb[b] : null, odd: 1 / (1 / o.x12[a] + 1 / o.x12[b]), y: j.r === S[a] || j.r === S[b] ? 1 : 0 });
  }
  if (o.ou25) { out.push({ t: 'tot', s: 'o', pm: pm.o, pk: qo ? qo[0] : null, pin: qpo ? qpo[0] : null, bfe: qbo ? qbo[0] : null, odd: o.ou25[0], y: j.tg > 2.5 ? 1 : 0 }, { t: 'tot', s: 'u', pm: 1 - pm.o, pk: qo ? qo[1] : null, pin: qpo ? qpo[1] : null, bfe: qbo ? qbo[1] : null, odd: o.ou25[1], y: j.tg < 2.5 ? 1 : 0 }); }
  return out.filter(l => l.odd > 1);
}
const cons = l => Number.isFinite(l.pk) ? (l.pm + l.pk) / 2 : l.pm;

// ---------- métricas financeiras ----------
function financas(apostas) {
  // apostas: [{data, odd, y, p}] em ordem de data. Aposta fixa de 1 unidade + Kelly fracionado (1/4, teto 3% da banca).
  const n = apostas.length; if (!n) return { n: 0 };
  let lucro = 0, acertos = 0, somaOdd = 0, somaImp = 0, pico = 0, queda = 0, seq = 0, pior = 0;
  for (const a of apostas) { const g = a.y ? a.odd - 1 : -1; lucro += g; acertos += a.y; somaOdd += a.odd; somaImp += 1 / a.odd; if (lucro > pico) pico = lucro; queda = Math.max(queda, pico - lucro); seq = a.y ? 0 : seq + 1; pior = Math.max(pior, seq); }
  let banca = 100, picoB = 100, quedaB = 0; const porDia = new Map(); for (const a of apostas) { const d = a.data.slice(0, 10); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(a); }
  for (const [, ds] of [...porDia].sort()) { const b0 = banca; for (const a of ds) { const f = Math.min(0.03, Math.max(0, 0.25 * (a.p * a.odd - 1) / (a.odd - 1))); banca += b0 * f * (a.y ? a.odd - 1 : -1); } picoB = Math.max(picoB, banca); quedaB = Math.max(quedaB, (picoB - banca) / picoB); }
  // intervalo de 90% do retorno por reamostragem
  let s = 12345; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }, rois = [];
  for (let b = 0; b < 400; b++) { let l = 0; for (let i = 0; i < n; i++) { const a = apostas[Math.floor(rnd() * n)]; l += a.y ? a.odd - 1 : -1; } rois.push(l / n); }
  rois.sort((a, b) => a - b);
  return { n, acerto: +(acertos / n).toFixed(4), chanceImplicita: +(somaImp / n).toFixed(4), oddMedia: +(somaOdd / n).toFixed(3), lucro: +lucro.toFixed(2), retorno: +(lucro / n).toFixed(4), ic90: [+rois[20].toFixed(4), +rois[379].toFixed(4)],
    quedaMaxima: +queda.toFixed(2), piorSequencia: pior, bancaKelly: +banca.toFixed(1), quedaKelly: +quedaB.toFixed(3) };
}
function simular(jogosP, regra, { fonte = 'b365', momento = 'pre', parte = 'teste' } = {}) {
  const ap = [];
  for (const j of jogosP) {
    if (parte === 'treino' && j.teste) continue; if (parte === 'teste' && !j.teste) continue;
    const ls = linhas(j, fonte, momento).filter(l => regra.filtro(l)); if (!ls.length) continue;
    const esc = regra.porJogo === 'todas' ? ls : [ls.reduce((b, l) => regra.nota(l) > regra.nota(b) ? l : b)];
    for (const l of esc) ap.push({ data: j.m.date, odd: l.odd, y: l.y, p: regra.prob ? regra.prob(l) : cons(l) });
  }
  ap.sort((a, b) => a.data.localeCompare(b.data));
  return financas(ap);
}

// ---------- execução ----------
const t0 = Date.now();
const base = await previsoes('base', {});
const J = montar(base);
log('jogos com previsão:', J.length, '· treino', J.filter(j => !j.teste).length, '· teste', J.filter(j => j.teste).length);

// 1) Qualidade das probabilidades: modelo × Bet365 × Pinnacle (fechamento), log loss do 1X2 e do 2,5.
function qualidade(js) {
  const c = { n: 0, modelo: 0, b365: 0, pin: 0, mistura: 0, nOU: 0, ouModelo: 0, ouB365: 0, ouPin: 0 };
  for (const j of js) { const f = j.m.odds.fech, qb = devig(f.b365.x12), qp = devig(f.ps.x12); if (!qb || !qp) continue; const i = { h: 0, d: 1, a: 2 }[j.r]; c.n++;
    c.modelo -= Math.log(j.pm[j.r]); c.b365 -= Math.log(qb[i]); c.pin -= Math.log(qp[i]); c.mistura -= Math.log(0.2 * j.pm[j.r] + 0.8 * qp[i]);
    const ob = devig(f.b365.ou25), op = devig(f.ps.ou25); if (ob && op) { const y = j.tg > 2.5; c.nOU++; c.ouModelo -= Math.log(y ? j.pm.o : 1 - j.pm.o); c.ouB365 -= Math.log(y ? ob[0] : ob[1]); c.ouPin -= Math.log(y ? op[0] : op[1]); } }
  const r = v => +(v).toFixed(4);
  return { n: c.n, logLoss1x2: { modelo: r(c.modelo / c.n), bet365: r(c.b365 / c.n), pinnacle: r(c.pin / c.n), mistura20: r(c.mistura / c.n) }, nOU: c.nOU, logLossOver25: { modelo: r(c.ouModelo / c.nOU), bet365: r(c.ouB365 / c.nOU), pinnacle: r(c.ouPin / c.nOU) } };
}
const Q = { treino: qualidade(J.filter(j => !j.teste)), teste: qualidade(J.filter(j => j.teste)) };
{ let n = 0, lp = 0, lb = 0, lb3 = 0; for (const j of J) { const p = devig(j.m.odds.pre.ps.x12), b = devig(j.m.odds.pre.bfe.x12), b3 = devig(j.m.odds.pre.b365.x12); if (!p || !b || !b3) continue; const i = { h: 0, d: 1, a: 2 }[j.r]; n++; lp -= Math.log(p[i]); lb -= Math.log(b[i]); lb3 -= Math.log(b3[i]); }
  Q.betfairXpinnacle = { n, pinnacle: +(lp / n).toFixed(4), betfair: +(lb / n).toFixed(4), bet365: +(lb3 / n).toFixed(4) }; log('Betfair × Pinnacle × Bet365 (antes da rodada, mesmos jogos):', JSON.stringify(Q.betfairXpinnacle)); }
log('qualidade:', JSON.stringify(Q));

// 2) Faixas de odd: o que cada faixa rende (todas as linhas da faixa, sem filtro do modelo) e com o filtro do modelo.
const FAIXAS = [[1.01, 1.35], [1.35, 1.6], [1.6, 2.0], [2.0, 2.6], [2.6, 3.5], [3.5, 5], [5, 8], [8, 13], [13, 100]];
const anterior = (() => { try { return JSON.parse(fs.readFileSync(path.join(DADOS, 'backtest.json'), 'utf8')); } catch { return null; } })(), RAPIDO = process.argv.includes('--rapido') && anterior;
const faixas = RAPIDO ? anterior.faixas : [];
for (const [lo, hi] of RAPIDO ? [] : FAIXAS) {
  const naFaixa = l => l.odd >= lo && l.odd < hi;
  faixas.push({ de: lo, ate: hi,
    tudo: { treino: simular(J, { filtro: naFaixa, porJogo: 'todas', nota: () => 0 }, { parte: 'treino' }), teste: simular(J, { filtro: naFaixa, porJogo: 'todas', nota: () => 0 }, { parte: 'teste' }) },
    modeloAcima: { treino: simular(J, { filtro: l => naFaixa(l) && l.pm * l.odd - 1 > 0.05, porJogo: 'todas', nota: () => 0, prob: l => l.pm }, { parte: 'treino' }), teste: simular(J, { filtro: l => naFaixa(l) && l.pm * l.odd - 1 > 0.05, porJogo: 'todas', nota: () => 0, prob: l => l.pm }, { parte: 'teste' }) },
    consensoAcima: { treino: simular(J, { filtro: l => naFaixa(l) && cons(l) * l.odd - 1 > 0.02 && Math.abs(l.pm - (l.pk ?? l.pm)) <= 0.08, porJogo: 'todas', nota: () => 0 }, { parte: 'treino' }), teste: simular(J, { filtro: l => naFaixa(l) && cons(l) * l.odd - 1 > 0.02 && Math.abs(l.pm - (l.pk ?? l.pm)) <= 0.08, porJogo: 'todas', nota: () => 0 }, { parte: 'teste' }) },
    melhorOdd: { treino: simular(J, { filtro: naFaixa, porJogo: 'todas', nota: () => 0 }, { parte: 'treino', fonte: 'max' }), teste: simular(J, { filtro: naFaixa, porJogo: 'todas', nota: () => 0 }, { parte: 'teste', fonte: 'max' }) } });
}
log('faixas prontas');

// 3) Grade de regras "uma aposta por jogo" e "todas as que passam": escolha pelo LUCRO no treino, conferência no teste.
const regras = [];
const notas = { chance: l => cons(l), valorModelo: l => l.pm * l.odd - 1, valorConsenso: l => cons(l) * l.odd - 1, valorPinnacle: l => (l.pin ?? cons(l)) * l.odd - 1 };
for (const [lo, hi] of [[1.35, 30], [1.35, 2.0], [1.6, 3.5], [2.0, 5], [2.6, 8], [3.5, 13], [5, 30]])
  for (const acordo of [0.05, 0.08, 1])
    for (const [nomeNota, nota] of Object.entries(notas))
      for (const minimo of nomeNota === 'chance' ? [0.4, 0.5, 0.6] : [0, 0.03, 0.06, 0.1])
        for (const porJogo of ['uma', 'todas']) {
          const filtro = l => l.odd >= lo && l.odd < hi && (!Number.isFinite(l.pk) || Math.abs(l.pm - l.pk) <= acordo) && nota(l) >= minimo && l.pm <= 0.92;
          regras.push({ id: [lo + '-' + hi, 'acordo' + acordo, nomeNota + '≥' + minimo, porJogo].join(' · '), lo, hi, acordo, nomeNota, minimo, porJogo, filtro, nota });
        }
log('regras:', regras.length);
if (!RAPIDO) for (const r of regras) { r.treino = simular(J, r, { parte: 'treino' }); } else for (const r of regras) r.treino = { n: 0 };
// Só regras com volume (≥ 150 apostas no treino) e retorno confiável; ordena pelo limite inferior do intervalo (penaliza sorte).
const candidatas = regras.filter(r => r.treino.n >= 150).sort((a, b) => b.treino.ic90[0] - a.treino.ic90[0] || b.treino.retorno - a.treino.retorno);
for (const r of candidatas.slice(0, 40)) { r.teste = simular(J, r, { parte: 'teste' }); r.testeFechamento = simular(J, r, { parte: 'teste', momento: 'fech' }); r.testeMelhorOdd = simular(J, r, { parte: 'teste', fonte: 'max' }); }
const semPin = regras.filter(r => r.nomeNota !== 'valorPinnacle' && r.treino.n >= 300).sort((a, b) => b.treino.retorno - a.treino.retorno).slice(0, 25);
for (const r of semPin) if (!r.teste) { r.teste = simular(J, r, { parte: 'teste' }); r.testeFechamento = simular(J, r, { parte: 'teste', momento: 'fech' }); r.testeMelhorOdd = simular(J, r, { parte: 'teste', fonte: 'max' }); }
const topoSemPinnacle = RAPIDO ? anterior.regrasSemPinnacle : semPin.map(r => ({ id: r.id, treino: r.treino, teste: r.teste, testeFechamento: r.testeFechamento, testeMelhorOdd: r.testeMelhorOdd }));
log('melhores sem Pinnacle (treino → teste):'); for (const r of topoSemPinnacle.slice(0, 12)) console.log('  ', r.id.padEnd(58), 'treino', r.treino.n, (r.treino.retorno * 100).toFixed(1) + '%', '→ teste', r.teste.n, (r.teste.retorno * 100).toFixed(1) + '%', 'ic', r.teste.ic90.map(v => (v * 100).toFixed(0)).join('/'), '· melhor odd', (r.testeMelhorOdd.retorno * 100).toFixed(1) + '%');
const topo = RAPIDO ? anterior.regrasTop : candidatas.slice(0, 40).map(r => ({ id: r.id, treino: r.treino, teste: r.teste, testeFechamento: r.testeFechamento, testeMelhorOdd: r.testeMelhorOdd }));
log('top 10 (treino → teste):'); for (const r of topo.slice(0, 10)) console.log('  ', r.id.padEnd(58), 'treino', r.treino.n, (r.treino.retorno * 100).toFixed(1) + '%', '→ teste', r.teste.n, (r.teste.retorno * 100).toFixed(1) + '%', 'ic', r.teste.ic90.map(v => (v * 100).toFixed(0)).join('/'), '· fechamento', (r.testeFechamento.retorno * 100).toFixed(1) + '%', '· melhor odd', (r.testeMelhorOdd.retorno * 100).toFixed(1) + '%');

// A regra atual do hub (principal e odd maior) no mesmo teste, para comparação.
const atual = {
  principal: { filtro: l => l.odd >= 1.35 && cons(l) >= 0.5 && l.pm <= 0.92 && (!Number.isFinite(l.pk) || Math.abs(l.pm - l.pk) <= 0.08), porJogo: 'uma', nota: cons },
  oddMaior: { filtro: l => l.odd >= 1.7 && l.odd <= 3.2 && (!Number.isFinite(l.pk) || (Math.abs(l.pm - l.pk) <= 0.08 && l.pm >= l.pk)), porJogo: 'uma', nota: cons }
};
// Regras recalibradas pelo lucro (candidatas para o hub).
const pinValor = l => Number.isFinite(l.pin) ? l.pin * l.odd - 1 : -1;
Object.assign(atual, {
  principal5: { filtro: l => l.odd >= 1.35 && cons(l) >= 0.5 && l.pm <= 0.92 && (!Number.isFinite(l.pk) || Math.abs(l.pm - l.pk) <= 0.05), porJogo: 'uma', nota: cons },
  valorConsenso: { filtro: l => l.odd >= 1.6 && l.odd < 3.5 && cons(l) >= 0.6 && Number.isFinite(l.pk) && Math.abs(l.pm - l.pk) <= 0.05, porJogo: 'uma', nota: cons },
  valorPinnacle: { filtro: l => l.odd >= 2.6 && l.odd < 13 && pinValor(l) >= 0 && Number.isFinite(l.pk) && Math.abs(l.pm - l.pk) <= 0.08, porJogo: 'uma', nota: pinValor, prob: l => l.pin },
  valorPinnacle2: { filtro: l => l.odd >= 2.0 && l.odd < 13 && pinValor(l) >= 0.02 && Number.isFinite(l.pk) && Math.abs(l.pm - l.pk) <= 0.08, porJogo: 'uma', nota: pinValor, prob: l => l.pin },
  valorBetfair: { filtro: l => l.odd >= 2.6 && l.odd < 13 && Number.isFinite(l.bfe) && l.bfe * l.odd - 1 >= 0 && Number.isFinite(l.pk) && Math.abs(l.pm - l.pk) <= 0.08, porJogo: 'uma', nota: l => l.bfe * l.odd - 1, prob: l => l.bfe },
  valorBetfair3: { filtro: l => l.odd >= 2.6 && l.odd < 13 && Number.isFinite(l.bfe) && l.bfe * l.odd - 1 >= 0.03 && Number.isFinite(l.pk) && Math.abs(l.pm - l.pk) <= 0.08, porJogo: 'uma', nota: l => l.bfe * l.odd - 1, prob: l => l.bfe },
  valorBetfairTudo: { filtro: l => l.odd >= 1.35 && l.odd < 13 && Number.isFinite(l.bfe) && l.bfe * l.odd - 1 >= 0.02, porJogo: 'uma', nota: l => l.bfe * l.odd - 1, prob: l => l.bfe },
  valorPinnacleTeste: { filtro: l => l.odd >= 2.6 && l.odd < 13 && Number.isFinite(l.pin) && Number.isFinite(l.bfe) && l.pin * l.odd - 1 >= 0 && Number.isFinite(l.pk) && Math.abs(l.pm - l.pk) <= 0.08, porJogo: 'uma', nota: l => l.pin * l.odd - 1, prob: l => l.pin },
  oddMaior26: { filtro: l => l.odd >= 1.7 && l.odd < 2.6 && (!Number.isFinite(l.pk) || (Math.abs(l.pm - l.pk) <= 0.05 && l.pm >= l.pk)), porJogo: 'uma', nota: cons }
});
// Retorno por temporada das regras (estabilidade no tempo).
const porTemporada = (r) => { const out = {}; for (const t of [...new Set(J.map(j => j.temporada))].sort()) { out[t] = simular(J.filter(j => j.temporada === t), r, { parte: 'tudo' }); } return out; };
const regraAtual = {}; for (const [k, r] of Object.entries(atual)) regraAtual[k] = { treino: simular(J, r, { parte: 'treino' }), teste: simular(J, r, { parte: 'teste' }), testeFechamento: simular(J, r, { parte: 'teste', momento: 'fech' }), testeMelhorOdd: simular(J, r, { parte: 'teste', fonte: 'max' }), porTemporada: porTemporada(r) };
log('regra atual:', JSON.stringify(regraAtual));
// Só as apostas que o hub recomendaria (principal + odd maior), separadas por faixa de odd.
const palpitesPorFaixa = [];
for (const [lo, hi] of [[1.35, 1.6], [1.6, 2.0], [2.0, 2.6], [2.6, 3.5]]) {
  const r = { treino: [], teste: [] };
  for (const [k, regra] of [['principal', atual.principal5], ['oddMaior', atual.oddMaior26]]) {
    const filtroFaixa = Object.assign({}, regra, { escolher: true });
    for (const parte of ['treino', 'teste']) {
      // escolhe pela regra (uma por jogo) e só depois filtra pela faixa da odd escolhida
      const ap = [];
      for (const j of J) { if (parte === 'treino' ? j.teste : !j.teste) continue; const ls = linhas(j, 'b365', 'pre').filter(regra.filtro); if (!ls.length) continue; const l = ls.reduce((b, x) => regra.nota(x) > regra.nota(b) ? x : b); if (l.odd >= lo && l.odd < hi) ap.push({ data: j.m.date, odd: l.odd, y: l.y, p: cons(l), tipo: k, mk: l.t }); }
      r[parte].push(...ap);
    }
  }
  const resumo = parte => { const ap = r[parte].sort((a, b) => a.data.localeCompare(b.data)); const f = financas(ap); f.porMercado = Object.fromEntries(['1x2', 'dc', 'tot'].map(t => [t, financas(ap.filter(a => a.mk === t))])); return f; };
  palpitesPorFaixa.push({ de: lo, ate: hi, treino: resumo('treino'), teste: resumo('teste') });
}
log('palpites por faixa:', JSON.stringify(palpitesPorFaixa.map(x => [x.de, x.ate, x.treino.n, x.treino.retorno, x.teste.n, x.teste.retorno])));

// 4) Variantes do modelo (opcional): sem odds de fechamento passadas, com xG.
let variantes = (() => { try { return JSON.parse(fs.readFileSync(path.join(DADOS, 'backtest.json'), 'utf8')).variantes || null; } catch { return null; } })();
if (process.argv.includes('--variantes')) {
  variantes = {};
  for (const [nome, cfg] of [['semMercado', { mktBlend: 0 }], ['xg50', { xgBlend: 0.5 }], ['xg50semMercado', { xgBlend: 0.5, mktBlend: 0 }], ['xg30', { xgBlend: 0.3 }], ['semChutes', { sotBlend: 0 }]]) {
    const p = await previsoes(nome, cfg), Jv = montar(p); variantes[nome] = { treino: qualidade(Jv.filter(j => !j.teste)), teste: qualidade(Jv.filter(j => j.teste)) };
    log('variante', nome, JSON.stringify(variantes[nome]));
  }
}

const saida = { geradoEm: new Date().toISOString(), fonte: 'football-data.co.uk (odds de Bet365, Pinnacle, média e melhor odd do mercado) + xG do Understat', ligas: [...comps], jogos: J.length,
  periodo: { previsoes: INICIO_PREV, inicioTeste: INICIO_TESTE }, qualidade: Q, faixas, palpitesPorFaixa, regrasTop: topo, regrasSemPinnacle: topoSemPinnacle, regraAtual, variantes, segundos: Math.round((Date.now() - t0) / 1000) };
gravarJSON(path.join(DADOS, 'backtest.json'), saida, { compacto: false });
log('ok · dados/backtest.json');
