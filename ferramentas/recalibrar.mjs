// Recalibração semanal com trava (roda no GitHub Actions toda segunda; dá para rodar à mão: node ferramentas/recalibrar.mjs).
// 1. Modelo: testa variações, uma de cada vez, dos ajustes atuais na validação semana a semana da base ESPN
//    (período de ajuste de 24 semanas + teste das últimas 14). Nota = log loss 1X2 + over 2,5 + ambas (menor é melhor).
//    Trava: melhorar pelo menos 0,002 nos DOIS períodos, com 400+ jogos no teste.
// 2. Regras dos palpites: testa variações no backtest da football-data (treino até 2023/24, teste de 2024/25 em diante),
//    retorno na odd da Bet365 de antes da rodada. Trava: +1 p.p. de retorno nos DOIS períodos, com volume mínimo no teste.
// 3. Decisão: uma mudança só é adotada se a MESMA passar na trava em duas semanas seguidas, e no máximo uma a cada 28 dias.
//    Tudo fica registrado em dados/modelo/recalibracao.json; o que for adotado vai para dados/modelo/parametros.json.
import path from 'node:path';
import { carregarHub, gravarJSON, lerJSON, lerRede, RAIZ } from './hub.mjs';
import { anexarImplicitos, implicitosFD } from './implicitos.mjs';
import { carregarFD, enriquecer } from './fd.mjs';

const { R, M, K, V, A } = carregarHub({ semRede: true });
const DADOS = process.env.DADOS_DIR || path.join(RAIZ, 'dados'), agora = new Date(), hoje = agora.toISOString().slice(0, 10);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const r4 = v => Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
const ARQ_PARAM = path.join(DADOS, 'modelo', 'parametros.json'), ARQ_ESTADO = path.join(DADOS, 'modelo', 'recalibracao.json');
const pub = lerJSON(ARQ_PARAM, { modelo: {}, regra: {}, mudancas: [] }), estado = lerJSON(ARQ_ESTADO, { semanas: [], pendente: null });
const TRAVA = { modelo: 0.002, nModelo: 400, regra: 0.01, nPrincipal: 1000, nOddMaior: 800, semanasSeguidas: 2, diasEntreMudancas: 28 };
const atualModelo = Object.assign({}, M.PADRAO, pub.modelo), atualRegra = Object.assign({}, A.REGRA_PALPITE, pub.regra);

// ---------- 1. Modelo (base ESPN enriquecida) ----------
const rede = lerRede(); if (!rede) throw new Error('Sem dados/rede.');
anexarImplicitos(rede.jogos, { M, K, dados: DADOS });
const fd = carregarFD({ dados: DADOS }).jogos, impFD = fd.length ? implicitosFD(fd, { K, arquivo: path.join(DADOS, 'externo', 'derivado', 'implicitos-fd.json') }) : {};
if (fd.length) enriquecer(rede.jogos, fd, impFD);
const comps = new Set(R.COMPS.filter(c => c.radar || c.opcional).map(c => c.id)), ultimo = rede.jogos.filter(m => m.done && comps.has(m.comp)).reduce((t, m) => Math.max(t, Date.parse(m.date)), 0);
const fim = new Date(ultimo + 864e5), corte = new Date(fim - 14 * 7 * 864e5), ini = new Date(corte - 24 * 7 * 864e5);
const nota = m => m.logLoss1x2 + m.logLossOver25 + m.logLossAmbas;
const cachePrev = new Map();
async function avaliarModelo(cfg) {
  const chaveFit = JSON.stringify(Object.assign({}, cfg, { esticar: 0 }));
  if (!cachePrev.has(chaveFit)) cachePrev.set(chaveFit, { pa: await V.walkForward(rede.jogos, cfg, { de: ini.toISOString(), ate: corte.toISOString(), comps }), pt: await V.walkForward(rede.jogos, cfg, { de: corte.toISOString(), ate: fim.toISOString(), comps }) });
  const { pa, pt } = cachePrev.get(chaveFit), ma = V.metricas(pa, { esticar: cfg.esticar }), mt = V.metricas(pt, { esticar: cfg.esticar });
  return { ajuste: r4(nota(ma)), teste: r4(nota(mt)), n: mt.n, teste1x2: mt.logLoss1x2 };
}
const variacoes = [
  ['mktBlend', v => [Math.max(0, v - 0.2), Math.min(0.9, v + 0.2)]], ['xgBlend', v => [Math.max(0, v - 0.2), Math.min(0.9, v + 0.2)]],
  ['sdTeam', v => [+(v * 0.8).toFixed(3), +(v * 1.2).toFixed(3)]], ['halfLife', v => [Math.round(v * 0.7), Math.round(v * 1.4)]],
  ['sotBlend', v => [Math.max(0, v - 0.2), Math.min(0.9, v + 0.2)]], ['esticar', v => [+(v - 0.1).toFixed(2), +(v + 0.1).toFixed(2)]]
];
log('modelo: avaliando os ajustes atuais');
const baseModelo = await avaliarModelo(atualModelo); log('  atual', JSON.stringify(baseModelo));
const candidatos = [];
for (const [p, gera] of variacoes) for (const v of [...new Set(gera(atualModelo[p]))]) {
  if (v === atualModelo[p]) continue;
  const r = await avaliarModelo(Object.assign({}, atualModelo, { [p]: v })), dA = r4(baseModelo.ajuste - r.ajuste), dT = r4(baseModelo.teste - r.teste);
  const passou = dA >= TRAVA.modelo && dT >= TRAVA.modelo && r.n >= TRAVA.nModelo;
  candidatos.push({ tipo: 'modelo', chave: 'modelo.' + p + '=' + v, param: p, valor: v, atual: atualModelo[p], ganhoAjuste: dA, ganhoTeste: dT, passou, margem: Math.min(dA, dT) / TRAVA.modelo });
  log('  ', p, atualModelo[p], '→', v, 'ganho ajuste', dA, 'teste', dT, passou ? 'PASSOU' : '');
}

// ---------- 2. Regras dos palpites (backtest football-data) ----------
let baseRegra = null;
if (fd.length) {
  for (const m of fd) { const i = impFD[m.id]; if (i) { m.ilh = i[0]; m.ila = i[1]; } }
  const fdComps = new Set(fd.map(m => m.comp)), fimFD = new Date(Date.parse(fd[fd.length - 1].date) + 864e5).toISOString();
  log('regras: previsões semana a semana na football-data');
  const prev = await V.walkForward(fd, Object.assign({}, atualModelo), { de: '2020-08-01', ate: fimFD, comps: fdComps });
  const porId = new Map(fd.map(m => [m.id, m])), s = atualModelo.esticar;
  const J = prev.map(x => { const m = porId.get(x.id), m0 = (x.eh + x.ea) / 2, lh = Math.exp(m0 + s * (x.eh - m0)), la = Math.exp(m0 + s * (x.ea - m0)), Mx = M.matriz(lh, la, x.rho, 10);
    const pm = { h: M.prob(Mx, { t: '1x2', s: 'h' }), d: M.prob(Mx, { t: '1x2', s: 'd' }), a: M.prob(Mx, { t: '1x2', s: 'a' }), o: M.prob(Mx, { t: 'tot', s: 'o', l: 2.5 }) };
    const o = m.odds.pre.b365, ls = [], r = m.hg > m.ag ? 'h' : m.hg === m.ag ? 'd' : 'a';
    if (o.x12) { const q = K.semMargem(o.x12).p, S = ['h', 'd', 'a']; S.forEach((t, i) => ls.push({ t: '1x2', pm: pm[t], pk: q[i], odd: o.x12[i], y: r === t ? 1 : 0 }));
      for (const [a, b] of [[0, 1], [2, 1], [0, 2]]) ls.push({ t: 'dc', pm: pm[S[a]] + pm[S[b]], pk: q[a] + q[b], odd: 1 / (1 / o.x12[a] + 1 / o.x12[b]), y: r === S[a] || r === S[b] ? 1 : 0 }); }
    if (o.ou25) { const q = K.semMargem(o.ou25).p, tg = m.hg + m.ag; ls.push({ t: 'tot', pm: pm.o, pk: q[0], odd: o.ou25[0], y: tg > 2.5 ? 1 : 0 }, { t: 'tot', pm: 1 - pm.o, pk: q[1], odd: o.ou25[1], y: tg < 2.5 ? 1 : 0 }); }
    return { teste: m.date >= '2024-07-01', ls }; });
  const cons = l => (l.pm + l.pk) / 2, melhor = ls => ls.reduce((b, l) => !b || cons(l) > cons(b) ? l : b, null);
  function simularRegra(rg) {
    const res = {}; for (const parte of ['treino', 'teste']) { const c = { principal: [0, 0], oddMaior: [0, 0] };
      for (const j of J) { if (j.teste !== (parte === 'teste')) continue;
        const p = melhor(j.ls.filter(l => l.odd >= rg.oddMin && cons(l) >= rg.chanceMin && l.pm <= rg.chanceMax && Math.abs(l.pm - l.pk) <= rg.acordo)); if (p) { c.principal[0]++; c.principal[1] += p.y ? p.odd - 1 : -1; }
        const o = melhor(j.ls.filter(l => l.odd >= rg.alt[0] && l.odd < rg.alt[1] && Math.abs(l.pm - l.pk) <= rg.acordo && l.pm >= l.pk && (!p || l.t !== p.t))); if (o) { c.oddMaior[0]++; c.oddMaior[1] += o.y ? o.odd - 1 : -1; } }
      res[parte] = { principal: { n: c.principal[0], retorno: r4(c.principal[1] / c.principal[0]) }, oddMaior: { n: c.oddMaior[0], retorno: r4(c.oddMaior[1] / c.oddMaior[0]) } }; }
    return res;
  }
  baseRegra = simularRegra(atualRegra); log('  atual', JSON.stringify(baseRegra));
  const variacoesRegra = [
    ['acordo', 'principal', [+(atualRegra.acordo - 0.01).toFixed(3), +(atualRegra.acordo + 0.02).toFixed(3)]], ['oddMin', 'principal', [+(atualRegra.oddMin - 0.05).toFixed(2), +(atualRegra.oddMin + 0.1).toFixed(2)]],
    ['chanceMin', 'principal', [+(atualRegra.chanceMin - 0.05).toFixed(2), +(atualRegra.chanceMin + 0.05).toFixed(2)]],
    ['alt', 'oddMaior', [[+(atualRegra.alt[0] - 0.1).toFixed(2), atualRegra.alt[1]], [+(atualRegra.alt[0] + 0.1).toFixed(2), atualRegra.alt[1]], [atualRegra.alt[0], +(atualRegra.alt[1] - 0.3).toFixed(2)], [atualRegra.alt[0], +(atualRegra.alt[1] + 0.4).toFixed(2)]]]
  ];
  for (const [p, alvo, valores] of variacoesRegra) for (const v of valores) {
    const r = simularRegra(Object.assign({}, atualRegra, { [p]: v })), alvos = p === 'acordo' ? ['principal', 'oddMaior'] : [alvo];
    for (const a of alvos) {
      const dA = r4(r.treino[a].retorno - baseRegra.treino[a].retorno), dT = r4(r.teste[a].retorno - baseRegra.teste[a].retorno), nMin = a === 'principal' ? TRAVA.nPrincipal : TRAVA.nOddMaior;
      const outro = a === 'principal' ? 'oddMaior' : 'principal', piora = p === 'acordo' && (r.teste[outro].retorno < baseRegra.teste[outro].retorno - 0.005 || r.treino[outro].retorno < baseRegra.treino[outro].retorno - 0.005);
      const passou = dA >= TRAVA.regra && dT >= TRAVA.regra && r.teste[a].n >= nMin && !piora;
      candidatos.push({ tipo: 'regra', chave: 'regra.' + p + '=' + JSON.stringify(v), param: p, valor: v, atual: atualRegra[p], palpite: a, ganhoTreino: dA, ganhoTeste: dT, nTeste: r.teste[a].n, passou, margem: Math.min(dA, dT) / TRAVA.regra });
      log('  ', a, p, JSON.stringify(atualRegra[p]), '→', JSON.stringify(v), 'ganho treino', dA, 'teste', dT, passou ? 'PASSOU' : '');
    }
  }
}

// ---------- 3. Decisão com trava ----------
const aprovados = candidatos.filter(c => c.passou).sort((a, b) => b.margem - a.margem), melhorCand = aprovados[0] || null;
const ultimaMudanca = (pub.mudancas || []).slice(-1)[0], diasDesde = ultimaMudanca ? (agora - Date.parse(ultimaMudanca.data)) / 864e5 : Infinity;
let decisao;
if (!melhorCand) { estado.pendente = null; decisao = 'Nenhuma variação passou na trava. Tudo fica como está.'; }
else {
  if (estado.pendente && estado.pendente.chave === melhorCand.chave) estado.pendente.semanas++; else estado.pendente = { chave: melhorCand.chave, semanas: 1, desde: hoje };
  if (estado.pendente.semanas < TRAVA.semanasSeguidas) decisao = 'Passou na trava pela 1ª vez: ' + melhorCand.chave + '. Só será adotada se passar de novo na próxima semana.';
  else if (diasDesde < TRAVA.diasEntreMudancas) decisao = 'Passou ' + estado.pendente.semanas + ' semanas seguidas, mas a última mudança foi há ' + Math.floor(diasDesde) + ' dias; espera completar ' + TRAVA.diasEntreMudancas + '.';
  else {
    const alvo = melhorCand.tipo === 'modelo' ? (pub.modelo = pub.modelo || {}) : (pub.regra = pub.regra || {}); alvo[melhorCand.param] = melhorCand.valor;
    (pub.mudancas = pub.mudancas || []).push({ data: agora.toISOString(), chave: melhorCand.chave, de: melhorCand.atual, para: melhorCand.valor, ganho: melhorCand.tipo === 'modelo' ? { ajuste: melhorCand.ganhoAjuste, teste: melhorCand.ganhoTeste } : { treino: melhorCand.ganhoTreino, teste: melhorCand.ganhoTeste, palpite: melhorCand.palpite } });
    pub.atualizadoEm = agora.toISOString(); gravarJSON(ARQ_PARAM, pub, { compacto: false });
    decisao = 'ADOTADA: ' + melhorCand.chave + ' (passou ' + estado.pendente.semanas + ' semanas seguidas).'; estado.pendente = null;
  }
}
estado.semanas.unshift({ data: agora.toISOString(), base: { modelo: baseModelo, regras: baseRegra }, candidatos, decisao, pendente: estado.pendente ? Object.assign({}, estado.pendente) : null });
estado.semanas = estado.semanas.slice(0, 26); estado.trava = TRAVA; estado.atual = { modelo: pub.modelo || {}, regra: pub.regra || {} };
gravarJSON(ARQ_ESTADO, estado, { compacto: false });
if (!lerJSON(ARQ_PARAM)) gravarJSON(ARQ_PARAM, { modelo: {}, regra: {}, mudancas: [], atualizadoEm: null }, { compacto: false });
log('decisão:', decisao);
