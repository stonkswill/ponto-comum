// Leitura das fontes externas (dados/externo): football-data.co.uk + xG do Understat, no formato de jogo do hub.
import fs from 'node:fs'; import path from 'node:path';
import { RAIZ } from './hub.mjs';

export const LIGA_FD = { E0: 'eng.1', E1: 'eng.2', SP1: 'esp.1', D1: 'ger.1', I1: 'ita.1', F1: 'fra.1', N1: 'ned.1', P1: 'por.1' };
const LIGA_US = { 'eng.1': 'EPL', 'esp.1': 'La_liga', 'ger.1': 'Bundesliga', 'ita.1': 'Serie_A', 'fra.1': 'Ligue_1' };

export function lerCSV(txt) {
  const linhas = txt.replace(/^﻿/, '').split('\n').filter(l => l.trim());
  const cab = linhas[0].split(',').map(s => s.trim()), out = [];
  for (const l of linhas.slice(1)) { const v = l.split(','), o = {}; cab.forEach((c, i) => { if (c) o[c] = (v[i] ?? '').trim(); }); out.push(o); }
  return out;
}
const n = v => { if (v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const odd = v => { const x = n(v); return x && x > 1.001 ? x : null; };
// Horário do Reino Unido → UTC (horário de verão britânico: último domingo de março ao último domingo de outubro).
export function dataUTC(d, t) {
  const [dd, mm, yy] = d.split('/').map(Number), ano = yy < 100 ? 2000 + yy : yy, [hh, mi] = (t && /\d+:\d+/.test(t) ? t : '15:00').split(':').map(Number);
  const ultimoDomingo = mes => { const x = new Date(Date.UTC(ano, mes + 1, 0)); return x.getUTCDate() - x.getUTCDay(); };
  const verao = (mm > 3 && mm < 10) || (mm === 3 && dd >= ultimoDomingo(2)) || (mm === 10 && dd < ultimoDomingo(9));
  return new Date(Date.UTC(ano, mm - 1, dd, hh - (verao ? 1 : 0), mi)).toISOString();
}
const trio = (r, a, b, c) => { const x = [odd(r[a]), odd(r[b]), odd(r[c])]; return x.every(Boolean) ? x : null; };
const par = (r, a, b) => { const x = [odd(r[a]), odd(r[b])]; return x.every(Boolean) ? x : null; };

/* Odds de um jogo. pre = coletadas antes da rodada (sexta/terça); fech = fechamento. b365 = Bet365, ps = Pinnacle, max = melhor odd do mercado, avg = média. */
export function oddsDe(r) {
  const o = { pre: {}, fech: {} };
  for (const [k, p] of [['b365', 'B365'], ['ps', 'PS'], ['bfe', 'BFE'], ['max', 'Max'], ['avg', 'Avg']]) {
    o.pre[k] = { x12: trio(r, p + 'H', p + 'D', p + 'A') || (k === 'max' ? trio(r, 'BbMxH', 'BbMxD', 'BbMxA') : k === 'avg' ? trio(r, 'BbAvH', 'BbAvD', 'BbAvA') : null) };
    o.fech[k] = { x12: trio(r, p + 'CH', p + 'CD', p + 'CA') };
  }
  const ou = { b365: ['B365>2.5', 'B365<2.5', 'B365C>2.5', 'B365C<2.5'], ps: ['P>2.5', 'P<2.5', 'PC>2.5', 'PC<2.5'], bfe: ['BFE>2.5', 'BFE<2.5', 'BFEC>2.5', 'BFEC<2.5'], max: ['Max>2.5', 'Max<2.5', 'MaxC>2.5', 'MaxC<2.5'], avg: ['Avg>2.5', 'Avg<2.5', 'AvgC>2.5', 'AvgC<2.5'] };
  for (const [k, [a, b, c, d]] of Object.entries(ou)) { o.pre[k].ou25 = par(r, a, b) || (k === 'max' ? par(r, 'BbMx>2.5', 'BbMx<2.5') : k === 'avg' ? par(r, 'BbAv>2.5', 'BbAv<2.5') : null); o.fech[k].ou25 = par(r, c, d); }
  return o;
}

const normalizar = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\b(fc|cf|ac|sc|afc|club|de|calcio|ssc|as|us|sv|vfb|vfl|tsg|fsv|ogc|rc|losc|stade|real|sporting|athletic|ath|cd|ud|sd|ca)\b/g, ' ').replace(/\s+/g, ' ').trim();
const APELIDOS = { 'man united': 'manchester united', 'man city': 'manchester city', 'nott m forest': 'nottingham forest', 'wolves': 'wolverhampton wanderers', 'sheffield weds': 'sheffield wednesday', 'qpr': 'queens park rangers', 'west brom': 'west bromwich albion', 'm gladbach': 'borussia m gladbach', 'ein frankfurt': 'eintracht frankfurt', 'paris sg': 'paris saint germain', 'st etienne': 'saint etienne', 'betis': 'betis', 'sociedad': 'sociedad', 'espanol': 'espanyol', 'vallecano': 'rayo vallecano', 'fc koln': 'koln', 'hertha': 'hertha berlin', 'leverkusen': 'bayer leverkusen', 'dortmund': 'borussia dortmund', 'bielefeld': 'arminia bielefeld', 'inter': 'internazionale', 'milan': 'milan', 'verona': 'verona' };
export function parecido(a, b) {
  const x = normalizar(APELIDOS[normalizar(a)] || a), y = normalizar(APELIDOS[normalizar(b)] || b); if (!x || !y) return 0;
  if (x === y) return 4; if (x.includes(y) || y.includes(x)) return 3;
  const tx = x.split(' '), ty = y.split(' ');
  if (tx.some(t => t.length >= 4 && ty.includes(t))) return 2; if (x.slice(0, 4) === y.slice(0, 4)) return 1; return 0;
}

/* Carrega tudo. Devolve jogos no formato do hub (ids de time "fd:Nome"), com odds e xG quando houver. */
export function carregarFD({ dados = path.join(RAIZ, 'dados'), ligas = Object.keys(LIGA_FD) } = {}) {
  const dir = path.join(dados, 'externo', 'fd'), jogos = [];
  if (!fs.existsSync(dir)) return { jogos, xg: 0 };
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort()) {
    const [liga, temp] = f.replace('.csv', '').split('-'); if (!ligas.includes(liga)) continue;
    for (const r of lerCSV(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (!r.HomeTeam || !r.Date || n(r.FTHG) === null) continue;
      const date = dataUTC(r.Date, r.Time);
      jogos.push({ id: liga + '|' + date.slice(0, 10) + '|' + r.HomeTeam + '|' + r.AwayTeam, comp: LIGA_FD[liga], liga, temporada: temp, date, h: 'fd:' + r.HomeTeam, a: 'fd:' + r.AwayTeam, hn: r.HomeTeam, an: r.AwayTeam, neutral: false, done: true, st: 'STATUS_FULL_TIME', state: 'post',
        fh: n(r.FTHG), fa: n(r.FTAG), hg: n(r.FTHG), ag: n(r.FTAG), h1: n(r.HTHG), a1: n(r.HTAG), hsh: n(r.HS), ash: n(r.AS), hst: n(r.HST), ast: n(r.AST), hc: n(r.HC), ac: n(r.AC), hf: n(r.HF), af: n(r.AF), hy: n(r.HY), ay: n(r.AY), hr: n(r.HR), ar: n(r.AR), arbitro: r.Referee || null, odds: oddsDe(r) });
    }
  }
  jogos.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  // xG do Understat: mesmo campeonato, data com até 1 dia de diferença, mesmo placar e nomes parecidos.
  const us = new Map(), dirUS = path.join(dados, 'externo', 'understat');
  if (fs.existsSync(dirUS)) for (const f of fs.readdirSync(dirUS)) { const [lg] = f.split('-'), comp = Object.keys(LIGA_US).find(c => LIGA_US[c] === lg); if (!comp) continue;
    for (const [id, dt, hn, an, hg, ag, xh, xa] of JSON.parse(fs.readFileSync(path.join(dirUS, f), 'utf8'))) { const k = comp + '|' + dt.slice(0, 10); if (!us.has(k)) us.set(k, []); us.get(k).push({ hn, an, hg, ag, xh, xa, usado: false }); } }
  let nxg = 0;
  const diaMais = (iso, d) => new Date(Date.parse(iso.slice(0, 10) + 'T12:00:00Z') + d * 864e5).toISOString().slice(0, 10);
  for (const m of jogos) {
    if (!LIGA_US[m.comp]) continue; let melhor = null, nota = 0;
    for (const d of [0, -1, 1]) for (const c of us.get(m.comp + '|' + diaMais(m.date, d)) || []) { if (c.usado || c.hg !== m.hg || c.ag !== m.ag) continue; const s = parecido(m.hn, c.hn) + parecido(m.an, c.an); if (s > nota) { nota = s; melhor = c; } }
    if (melhor && nota >= 2) { melhor.usado = true; m.xgh = melhor.xh; m.xga = melhor.xa; nxg++; }
  }
  return { jogos, xg: nxg };
}

/* Junta a football-data aos jogos da ESPN (mesma liga, data com até 1 dia, mesmo placar, nomes parecidos) e anexa:
 * - ilh/ila: gols esperados implícitos no fechamento da Pinnacle (ou da média do mercado), mais afiados que os da DraftKings;
 * - xgh/xga: xG do Understat. Devolve quantos jogos receberam cada um. */
export function enriquecer(jogosESPN, fd, implicitos) {
  const idx = new Map(); for (const f of fd) { const k = f.comp + '|' + f.date.slice(0, 10); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(f); }
  const dia = (iso, d) => new Date(Date.parse(iso.slice(0, 10) + 'T12:00:00Z') + d * 864e5).toISOString().slice(0, 10);
  let nImp = 0, nXg = 0;
  for (const m of jogosESPN) {
    if (!m.done || m.hg == null || !Object.values(LIGA_FD).includes(m.comp)) continue;
    let melhor = null, nota = 0;
    for (const d of [0, -1, 1]) for (const f of idx.get(m.comp + '|' + dia(m.date, d)) || []) { if (f.hg !== m.hg || f.ag !== m.ag) continue; const s = parecido(m.hn, f.hn) + parecido(m.an, f.an); if (s > nota) { nota = s; melhor = f; } }
    if (!melhor || nota < 3) continue;
    const im = implicitos[melhor.id]; if (im) { m.ilh = im[0]; m.ila = im[1]; nImp++; }
    if (melhor.xgh != null) { m.xgh = melhor.xgh; m.xga = melhor.xga; nXg++; }
  }
  return { implicitos: nImp, xg: nXg };
}

/* Próximos jogos (fixtures.csv da football-data): odds de antes da rodada da Bet365, Pinnacle, média e melhor odd do mercado. */
export function lerProximos(txt) {
  return lerCSV(txt).filter(r => r.HomeTeam && r.Date && LIGA_FD[r.Div]).map(r => { const o = oddsDe(r).pre; return { liga: r.Div, comp: LIGA_FD[r.Div], date: dataUTC(r.Date, r.Time), casa: r.HomeTeam, fora: r.AwayTeam,
    odds: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { x12: v.x12, ou25: v.ou25 }])) }; });
}
