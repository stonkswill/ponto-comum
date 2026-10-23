// Robô do Ponto Comum (roda no GitHub Actions, onde há acesso à ESPN).
// 1. Base de jogos (30 competições × 3 anos) → dados/rede/
// 2. Odds de abertura e fechamento da DraftKings dos jogos encerrados → dados/odds/
// 3. Cotações pré-jogo (DraftKings + Bet365) dos jogos das próximas 40 h → dados/pre/
// 4. Previsões e palpites do hub (melhores apostas por jogo), congelados no início de cada jogo → dados/previsoes/
// 5. Revisão: o que o hub disse × o que aconteceu → dados/revisao.json
import fs from 'node:fs'; import path from 'node:path';
import { carregarHub, gravarJSON, lerJSON, RAIZ } from './hub.mjs';
import { revisar } from './revisar.mjs';
import { anexarImplicitos } from './implicitos.mjs';

const { R, M, K, A, B, D } = carregarHub();
const DADOS = process.env.DADOS_DIR || path.join(RAIZ, 'dados'), agora = Number(process.env.AGORA) || Date.now(), ano = new Date(agora).getUTCFullYear();
const MAX_ODDS = Number(process.env.MAX_ODDS || 2500);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const r4 = v => Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
const RADAR = R.COMPS.filter(c => c.radar || c.opcional).map(c => c.id);

// ---------- 1. Base de jogos ----------
const rede = await R.carregarRede({ anos: [ano - 2, ano - 1, ano], onProgress: (d, t) => { if (d % 20 === 0) log('rede', d + '/' + t); } });
const falhas = rede.relatorio.filter(x => !x.ok);
log('rede:', rede.jogos.length, 'jogos;', falhas.length, 'falhas', falhas.slice(0, 5).map(x => x.comp + ' ' + x.ano + ' ' + x.erro).join(' | '));
const porId = new Map(rede.jogos.map(m => [m.id, m]));
const mesclar = lista => { for (const m of lista) { const v = porId.get(m.id); if (v) Object.assign(v, m); else { porId.set(m.id, m); rede.jogos.push(m); } } };

// ---------- 2. Odds de abertura e fechamento ----------
const dirOdds = path.join(DADOS, 'odds'), odds = new Map(), sujos = new Set();
const arqOdds = (comp, y) => path.join(dirOdds, comp + '-' + y + '.json');
const compacta = b => b ? [b.h, b.d, b.a, b.linha, b.over, b.under].map(v => Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null) : null;
const pendentesOdds = [];
for (const m of rede.jogos) {
  if (!m.done || !RADAR.includes(m.comp)) continue; const y = new Date(m.date).getUTCFullYear(); if (y < ano - 1) continue;
  const k = m.comp + '|' + y; if (!odds.has(k)) odds.set(k, lerJSON(arqOdds(m.comp, y), {}));
  if (!(m.id in odds.get(k))) pendentesOdds.push({ m, k });
}
pendentesOdds.sort((a, b) => Date.parse(b.m.date) - Date.parse(a.m.date));
let nOdds = 0;
await R.pool(pendentesOdds.slice(0, MAX_ODDS).map(({ m, k }) => async () => {
  let o = null, ok = true; try { o = await R.carregarOddsFechamento(m); } catch { ok = false; }
  if (!ok) return; odds.get(k)[m.id] = o ? { a: compacta(o.abertura), f: compacta(o.fechamento) } : 0; sujos.add(k); nOdds++;
  if (nOdds % 250 === 0) log('odds', nOdds + '/' + Math.min(MAX_ODDS, pendentesOdds.length));
}), 6);
for (const k of sujos) { const [comp, y] = k.split('|'); gravarJSON(arqOdds(comp, y), odds.get(k)); }
log('odds:', nOdds, 'novas;', Math.max(0, pendentesOdds.length - MAX_ODDS), 'ficam para a próxima');
const sujosI = anexarImplicitos(rede.jogos, { M, K, dados: DADOS, odds });
for (const k of sujosI) { const [comp, y] = k.split('|'); gravarJSON(arqOdds(comp, y), odds.get(k)); }
log('gols implícitos:', rede.jogos.filter(m => m.ilh != null).length, 'jogos');
const dirRede = path.join(DADOS, 'rede'), indiceAntigo = lerJSON(path.join(dirRede, 'indice.json'), { arquivos: [] });
const arquivos = [];
for (const c of R.COMPS) for (const y of [ano - 2, ano - 1, ano]) {
  const nome = c.id + '-' + y + '.json', rel = rede.relatorio.find(x => x.comp === c.id && x.ano === y), antigo = indiceAntigo.arquivos.find(a => a.arquivo === nome);
  if (!rel || !rel.ok) { if (antigo) arquivos.push(antigo); continue; }
  // Sem as odds dos jogos futuros: elas mudam a cada hora e o site busca as do dia ao vivo.
  const lista = rede.jogos.filter(m => m.comp === c.id && new Date(m.date).getUTCFullYear() === y).map(m => { const { odds, ...resto } = m; return resto; });
  const mudou = gravarJSON(path.join(dirRede, nome), lista);
  arquivos.push({ arquivo: nome, comp: c.id, ano: y, n: lista.length, atualizadoEm: mudou || !antigo ? new Date(agora).toISOString() : antigo.atualizadoEm, truncado: !!rel.truncado });
}
gravarJSON(path.join(dirRede, 'indice.json'), { geradoEm: new Date(agora).toISOString(), versao: 3, arquivos }, { compacto: false });


// ---------- 3. Agenda, cotações pré-jogo e modelo ----------
const hoje = R.dataSP(new Date(agora).toISOString()), amanha = R.dataSP(new Date(agora + 864e5).toISOString());
for (const d of [hoje, amanha]) { try { const r = await R.carregarDia(d, RADAR); mesclar(r.jogos); } catch (e) { log('agenda', d, e.message); } }
rede.jogos.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
const porTime = R.indexar(rede.jogos);
log('ajustando modelos…');
const F = M.ajustarGols(rede.jogos), Fe = M.ajustarContagem(rede.jogos, 'escanteios'), Fc = M.ajustarContagem(rede.jogos, 'cartoes'), forca = M.tabelaForca(F);
const grandes = new Set(); for (const [liga, n] of Object.entries(R.GRANDES_POR_LIGA)) for (const x of forca.lista.filter(x => x.grupo === 'L:' + liga).slice(0, n)) grandes.add(x.id);
const passaFiltro = m => R.COMP_MAP[m.comp].radar && (!R.GRANDES_POR_LIGA[m.comp] || grandes.has(m.h) || grandes.has(m.a));
gravarJSON(path.join(DADOS, 'grandes.json'), Object.fromEntries(Object.keys(R.GRANDES_POR_LIGA).map(l => [l, forca.lista.filter(x => x.grupo === 'L:' + l).slice(0, R.GRANDES_POR_LIGA[l]).map(x => ({ id: x.id, nome: x.nome, posicao: x.posicao }))])), { compacto: false });

const proximos = rede.jogos.filter(m => RADAR.includes(m.comp) && !m.done && !m.void && m.state !== 'in' && Date.parse(m.date) > agora && Date.parse(m.date) < agora + 40 * 3600e3);
log('próximos jogos:', proximos.length);
const fortes = a => { const porTipo = new Map(); for (const l of a.linhas.filter(l => ['1x2', 'dc', 'btts', 'tot'].includes(l.mk.t) && !(l.mk.t === 'btts' && l.mk.s === 'n') && l.pModelo >= 0.55 && l.pModelo <= 0.88 && l.concorda !== false).sort((x, y) => Math.abs(x.pModelo - 0.7) - Math.abs(y.pModelo - 0.7))) if (!porTipo.has(l.mk.t)) porTipo.set(l.mk.t, l); return [...porTipo.values()]; };
const TIPO = { cotada: 'c', mercado: 'k', modelo: 'm' };
const analisesPorDia = new Map(), pre = new Map(), prev = new Map();
const arqDia = (pasta, d) => path.join(DADOS, pasta, d + '.json');
await R.pool(proximos.map(m => async () => {
  let resumo = null; try { resumo = await R.carregarResumo(m); } catch { resumo = { cotacoes: [] }; }
  const visto = new Set((resumo.cotacoes || []).map(q => q.casa + '|' + K.chave(q.mk))), cot = (resumo.cotacoes || []).concat(K.doPlacar(m).filter(q => !visto.has(q.casa + '|' + K.chave(q.mk))));
  const liga = id => { const g = forca.porId.get(id); return g && g.grupo.startsWith('L:') ? g.grupo.slice(2) : m.comp; };
  const [ec, ef] = await Promise.all([m.h, m.a].map(id => R.carregarElenco(liga(id), id).catch(() => null)));
  const a = A.analisar(m, { F, Fe, Fc, porTime, forca, cotacoes: cot, resumo, elencos: { casa: ec, fora: ef }, agora });
  for (const [id, e] of [[m.h, ec], [m.a, ef]]) if (e) gravarJSON(path.join(DADOS, 'elencos', id + '.json'), { em: new Date(agora).toISOString(), liga: e.liga, atual: e.atual.map(p => [p.id, p.nome, p.pos, p.jogos, p.banco, p.gols, p.noAlvo, p.lesionado ? 1 : 0]), anterior: e.anterior.map(p => [p.id, p.nome, p.pos, p.jogos, p.banco, p.gols, p.noAlvo, 0]) });
  const d = R.dataSP(m.date);
  if (!pre.has(d)) pre.set(d, lerJSON(arqDia('pre', d), {}));
  pre.get(d)[m.id] = { em: new Date(agora).toISOString(), cot: cot.map(q => [q.casa, K.chave(q.mk), q.odd]), escalacoes: !!(resumo.escalacoes && resumo.escalacoes.some(e => e.titulares.length >= 11)), jogadores: resumo.jogadores ? { casa: resumo.jogadores.casa, qualquer: resumo.jogadores.qualquer.map(x => [x.nome, x.odd]), primeiro: resumo.jogadores.primeiro.map(x => [x.nome, x.odd]) } : null };
  if (!prev.has(d)) prev.set(d, lerJSON(arqDia('previsoes', d), { jogos: {} }));
  prev.get(d).jogos[m.id] = { comp: m.comp, inicio: m.date, casa: m.hn, fora: m.an, h: m.h, a: m.a, filtro: passaFiltro(m), em: new Date(agora).toISOString(),
    lh: r4(a.lh), la: r4(a.la), mercado: a.ref ? { lh: r4(a.ref.lh), la: r4(a.ref.la), fonte: a.ref.fonte } : null,
    linhas: Object.fromEntries(a.linhas.map(l => [l.chave, [r4(l.pModelo), r4(l.pMercado), l.odd, TIPO[l.oddTipo] || '?']])),
    leitura: fortes(a).map(l => l.chave), destaques: a.destaques.map(l => l.chave),
    jogadores: { casa: a.jogadores.casa.map(j => [j.nome, r4(j.p), j.odd]), fora: a.jogadores.fora.map(j => [j.nome, r4(j.p), j.odd]) },
    palpites: (() => { const P = a.palpites, l = x => x && { chave: x.chave, rotulo: x.rotulo, odd: x.odd, tipoOdd: TIPO[x.oddTipo] || '?', chance: r4(P.chance(x)), pModelo: r4(x.pModelo), pMercado: r4(x.pMercado) };
      const jl = P.jogador && (a.jogadores.casa.includes(P.jogador) ? 'h' : 'a');
      return { nada: !!P.nada, principal: l(P.principal), oddMaior: l(P.oddMaior), destaque: l(P.destaque), jogador: P.jogador && { nome: P.jogador.nome, lado: jl, p: r4(P.jogador.p), odd: P.jogador.odd } }; })() };
  if (!analisesPorDia.has(d)) analisesPorDia.set(d, []); analisesPorDia.get(d).push(a);
}), 4);

// Amostra crua das odds de um resumo com Bet365 (para conferir os nomes dos campos de cada mercado).
for (const m of proximos.slice(0, 15)) { try { const j = await (await fetch(R.ESPN + m.comp + '/summary?event=' + m.id)).json(), todas = [...(j.odds || []), ...(j.pickcenter || [])];
  if (!todas.some(o => o && o.bettingOdds)) continue; gravarJSON(path.join(DADOS, 'amostras', 'resumo-odds.json'), { jogo: m.hn + ' × ' + m.an, comp: m.comp, odds: j.odds || null, pickcenter: j.pickcenter || null }, { compacto: false }); break; } catch (e) { log('amostra', e.message); } }

for (const [d, x] of pre) gravarJSON(arqDia('pre', d), x);
for (const [d, x] of prev) { x.geradoEm = new Date(agora).toISOString(); gravarJSON(arqDia('previsoes', d), x); }

// ---------- 5. Revisão ----------
const rev = revisar({ K, D, jogos: porId, dados: DADOS });
gravarJSON(path.join(DADOS, 'revisao.json'), rev, { compacto: false });
log('revisão:', rev.jogos, 'jogos apurados');
