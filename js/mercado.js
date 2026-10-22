/* Ponto Comum v3 · mercado.js
 * Cotações (DraftKings e Bet365 via ESPN), probabilidade sem margem e gols esperados implícitos no preço.
 * Validação (jul–out/2026, 609 jogos): o fechamento sem margem da DraftKings errou menos que o modelo
 * (log loss 1X2 0,935 × 0,968). Por isso o mercado é a referência quando existe; o modelo cobre o resto.
 */
(function (G) {
  'use strict';
  const R = () => G.PCRede;
  const chave = mk => mk.t + ':' + mk.s + (mk.l !== undefined && mk.l !== null ? ':' + (Array.isArray(mk.l) ? mk.l.join('-') : mk.l) : '');
  const meia = l => Number.isFinite(l) && Math.abs(l * 2 - Math.round(l * 2)) < 1e-9 && Math.abs(l - Math.round(l)) > 1e-9;
  const fmtLinha = l => (l > 0 ? '+' : '') + String(l).replace('.', ',');

  function rotulo(mk, casa = 'Mandante', fora = 'Visitante') {
    const L = mk.l !== undefined && mk.l !== null && !Array.isArray(mk.l) ? String(mk.l).replace('.', ',') : '';
    switch (mk.t) {
      case '1x2': return mk.s === 'h' ? 'Vitória ' + casa : mk.s === 'a' ? 'Vitória ' + fora : 'Empate';
      case 'dc': return mk.s === '1x' ? casa + ' ou empate' : mk.s === 'x2' ? fora + ' ou empate' : 'Sem empate (' + casa + ' ou ' + fora + ')';
      case 'btts': return mk.s === 's' ? 'Ambas marcam: sim' : 'Ambas marcam: não';
      case 'tot': return (mk.s === 'o' ? 'Mais de ' : 'Menos de ') + L + ' gols';
      case 'tm': return (mk.s[0] === 'h' ? casa : fora) + (mk.s[1] === 'o' ? ': mais de ' : ': menos de ') + L + ' gols';
      case 'ah': return (mk.s === 'h' ? casa : fora) + ' ' + fmtLinha(mk.l) + ' (handicap)';
      case 'cs': return 'Placar exato ' + mk.l[0] + '–' + mk.l[1];
      case 't1': return '1º tempo: ' + (mk.s === 'o' ? 'mais de ' : 'menos de ') + L + ' gols';
      case 't2': return '2º tempo: ' + (mk.s === 'o' ? 'mais de ' : 'menos de ') + L + ' gols';
      case 'tmg': return 'Tempo com mais gols: ' + (mk.s === '1' ? '1º tempo' : mk.s === '2' ? '2º tempo' : 'empate');
      case 'pg': return mk.s === 'h' ? casa + ' marca primeiro' : mk.s === 'a' ? fora + ' marca primeiro' : 'Jogo sem gols';
      case 'esc': return 'Escanteios: ' + (mk.s === 'o' ? 'mais de ' : 'menos de ') + L;
      case 'escT': return (mk.s[0] === 'h' ? casa : fora) + ': ' + (mk.s[1] === 'o' ? 'mais de ' : 'menos de ') + L + ' escanteios';
      case 'car': return 'Cartões: ' + (mk.s === 'o' ? 'mais de ' : 'menos de ') + L;
      case 'carT': return (mk.s[0] === 'h' ? casa : fora) + ': ' + (mk.s[1] === 'o' ? 'mais de ' : 'menos de ') + L + ' cartões';
      default: return chave(mk);
    }
  }
  function familia(mk) { return ['1x2', 'dc', 'ah'].includes(mk.t) ? 'resultado' : ['tot', 'tm', 'btts', 'cs'].includes(mk.t) ? 'gols' : ['t1', 't2', 'tmg', 'pg'].includes(mk.t) ? 'tempos' : mk.t.startsWith('esc') ? 'escanteios' : mk.t.startsWith('car') ? 'cartoes' : 'outros'; }

  /* Cotações do resumo da ESPN. Cada uma: { casa, mk, odd }. Só linhas binárias (meio gol). */
  function doResumo(j, m) {
    const out = [], visto = new Set(), A = R().americana, F = R().fracionaria;
    const add = (casa, mk, odd) => { if (!(odd > 1.005 && odd < 1000)) return; if ((mk.t === 'tot' || mk.t === 'ah') && !meia(mk.l)) return; const k = casa + '|' + chave(mk); if (visto.has(k)) return; visto.add(k); out.push({ casa, mk, odd: +odd.toFixed(3) }); };
    for (const o of [...(j.odds || []), ...(j.pickcenter || [])]) {
      if (!o || typeof o !== 'object') continue;
      const casa = (o.provider && o.provider.name) || 'Casa', ml = o.moneyline || {}, tt = o.total || {}, ps = o.pointSpread || {};
      const atual = s => s ? (s.close || s.current || null) : null;
      const h = A((atual(ml.home) || {}).odds) || A(o.homeTeamOdds && o.homeTeamOdds.moneyLine), d = A((atual(ml.draw) || {}).odds) || A(o.drawOdds && o.drawOdds.moneyLine), a = A((atual(ml.away) || {}).odds) || A(o.awayTeamOdds && o.awayTeamOdds.moneyLine);
      if (h && d && a) { add(casa, { t: '1x2', s: 'h' }, h); add(casa, { t: '1x2', s: 'd' }, d); add(casa, { t: '1x2', s: 'a' }, a); }
      const ov = atual(tt.over), un = atual(tt.under);
      if (ov && un) { const lo = Number(String(ov.line || '').replace(/^o/i, '')), lu = Number(String(un.line || '').replace(/^u/i, '')); if (lo === lu) { add(casa, { t: 'tot', s: 'o', l: lo }, A(ov.odds)); add(casa, { t: 'tot', s: 'u', l: lu }, A(un.odds)); } }
      else if (R().num(o.overUnder) !== null && A(o.overOdds) && A(o.underOdds)) { add(casa, { t: 'tot', s: 'o', l: +o.overUnder }, A(o.overOdds)); add(casa, { t: 'tot', s: 'u', l: +o.overUnder }, A(o.underOdds)); }
      for (const lado of ['home', 'away']) { const p = atual(ps[lado]); if (p && p.line !== undefined) add(casa, { t: 'ah', s: lado === 'home' ? 'h' : 'a', l: Number(p.line) }, A(p.odds)); }
      const b = (o.bettingOdds && o.bettingOdds.teamOdds) || {}, f = k => b[k] ? F(b[k].value ?? b[k]) : null;
      const r1 = f('preMatchFullTimeResultHome'), rx = f('preMatchFullTimeResultDraw'), r2 = f('preMatchFullTimeResultAway');
      if (r1 && rx && r2) { add(casa, { t: '1x2', s: 'h' }, r1); add(casa, { t: '1x2', s: 'd' }, rx); add(casa, { t: '1x2', s: 'a' }, r2); }
      add(casa, { t: 'dc', s: '1x' }, f('preMatchDoubleChanceHomeOrDraw')); add(casa, { t: 'dc', s: 'x2' }, f('preMatchDoubleChanceDrawOrAway')); add(casa, { t: 'dc', s: '12' }, f('preMatchDoubleChanceHomeOrAway'));
      add(casa, { t: 'btts', s: 's' }, f('preMatchBothTeamsToScoreYes')); add(casa, { t: 'btts', s: 'n' }, f('preMatchBothTeamsToScoreNo'));
      const gl = b.preMatchOverUnderHandicap ? Number(String(b.preMatchOverUnderHandicap.value ?? b.preMatchOverUnderHandicap).split(',')[0]) : NaN;
      if (meia(gl)) { add(casa, { t: 'tot', s: 'o', l: gl }, f('preMatchGoalLineOver')); add(casa, { t: 'tot', s: 'u', l: gl }, f('preMatchGoalLineUnder')); }
    }
    return out;
  }
  /* Odds de jogador da Bet365 (marcar a qualquer momento e primeiro gol), quando a ESPN publica. */
  const normNome = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  function jogadoresDoResumo(j) {
    const F = R().fracionaria, out = { casa: null, qualquer: [], primeiro: [] };
    for (const o of [...(j.odds || []), ...(j.pickcenter || [])]) {
      const po = o && o.bettingOdds && o.bettingOdds.playerOdds; if (!po || out.casa) continue;
      out.casa = (o.provider && o.provider.name) || 'Casa';
      const ler = lista => (Array.isArray(lista) ? lista : []).map(x => ({ nome: String(x.player || ''), odd: F(x.value) })).filter(x => x.nome && x.odd > 1);
      out.qualquer = ler(po.preMatchAnyTimeGoalScorer); out.primeiro = ler(po.preMatchFirstGoalScorer);
    }
    return out.qualquer.length || out.primeiro.length ? out : null;
  }
  /* Acha um jogador numa lista pelo nome (exato sem acentos; senão sobrenome + inicial). */
  function acharJogador(lista, nome) {
    const n = normNome(nome); if (!n || !lista) return null; let x = lista.find(p => normNome(p.nome) === n); if (x) return x;
    const partes = n.split(' '), ult = partes[partes.length - 1], ini = partes[0][0];
    const c = lista.filter(p => { const q = normNome(p.nome).split(' '); return q[q.length - 1] === ult && q[0][0] === ini; }); return c.length === 1 ? c[0] : null;
  }

  /* Cotações a partir do placar do dia (só DraftKings 1X2 + linha principal). */
  function doPlacar(m) {
    const o = m && m.odds; if (!o) return [];
    const out = [], c = o.casa;
    if (o.h && o.d && o.a) out.push({ casa: c, mk: { t: '1x2', s: 'h' }, odd: o.h }, { casa: c, mk: { t: '1x2', s: 'd' }, odd: o.d }, { casa: c, mk: { t: '1x2', s: 'a' }, odd: o.a });
    if (o.over && o.under && meia(o.linha)) out.push({ casa: c, mk: { t: 'tot', s: 'o', l: o.linha }, odd: o.over }, { casa: c, mk: { t: 'tot', s: 'u', l: o.linha }, odd: o.under });
    return out;
  }

  /* Probabilidade sem margem de um mercado completo de uma casa.
   * 1X2 (3 resultados): método da potência, p = (1/odd)^k com k tal que a soma dê 1. Põe mais margem nas zebras, onde ela
   * de fato está: com 2.418 jogos reais da DraftKings, errou menos que a divisão proporcional (0,9646 × 0,9655 no fechamento).
   * Dois resultados (mais/menos, ambas): proporcional (os métodos empataram). */
  function semMargem(odds) {
    const inv = odds.map(o => 1 / o), s = inv.reduce((a, b) => a + b, 0);
    if (odds.length < 3 || !(s > 1)) return { p: inv.map(v => v / s), margem: s - 1 };
    let lo = 0.5, hi = 2.5; for (let i = 0; i < 50; i++) { const k = (lo + hi) / 2, t = inv.reduce((a, v) => a + Math.pow(v, k), 0); if (t > 1) lo = k; else hi = k; }
    const k = (lo + hi) / 2, p = inv.map(v => Math.pow(v, k)), t = p.reduce((a, b) => a + b, 0);
    return { p: p.map(v => v / t), margem: s - 1 };
  }

  /* Referência do mercado para a partida: 1X2 e linha principal sem margem, e os λ implícitos. */
  function referencia(cotacoes, rho = -0.03) {
    const porCasa = new Map(); for (const q of cotacoes) { let l = porCasa.get(q.casa); if (!l) porCasa.set(q.casa, l = []); l.push(q); }
    const ordem = [...porCasa.keys()].sort((a, b) => (/draftkings/i.test(b) ? 1 : 0) - (/draftkings/i.test(a) ? 1 : 0));
    let x12 = null, tot = null, fonte = [];
    for (const casa of ordem) {
      const qs = porCasa.get(casa), g = s => qs.find(q => q.mk.t === '1x2' && q.mk.s === s);
      if (!x12 && g('h') && g('d') && g('a')) { const r = semMargem([g('h').odd, g('d').odd, g('a').odd]); x12 = { p: r.p, margem: r.margem, casa }; fonte.push(casa); }
      if (!tot) { const ov = qs.filter(q => q.mk.t === 'tot' && q.mk.s === 'o'); for (const o of ov) { const u = qs.find(q => q.mk.t === 'tot' && q.mk.s === 'u' && q.mk.l === o.mk.l); if (u) { const r = semMargem([o.odd, u.odd]); const cand = { linha: o.mk.l, pOver: r.p[0], margem: r.margem, casa }; if (!tot || Math.abs(cand.pOver - 0.5) < Math.abs(tot.pOver - 0.5)) tot = cand; } } if (tot && !fonte.includes(tot.casa)) fonte.push(tot.casa); }
    }
    if (!x12 && !tot) return null;
    const im = G.PCModelo.implicitos(x12 ? x12.p : null, tot, rho);
    return { x12, tot, lh: im.lh, la: im.la, erro: im.erro, fonte: fonte.join(' + '), completo: !!(x12 && tot) };
  }
  /* Melhor preço disponível para um mercado. */
  function melhorOdd(cotacoes, mk) { const k = chave(mk); let best = null; for (const q of cotacoes) if (chave(q.mk) === k && (!best || q.odd > best.odd)) best = q; return best; }

  /* Odd sugerida para qualquer linha: média das casas que cotam a linha; sem cotação, o preço justo do mercado
   * com a margem típica das casas grandes; sem mercado, o preço justo do modelo com margem um pouco maior. */
  const MARGEM_TIPICA = 0.055;
  function oddSugerida(cotacoes, mk, pMercado, pModelo) {
    const k = chave(mk), qs = cotacoes.filter(q => chave(q.mk) === k);
    if (qs.length) return { odd: +(qs.reduce((s, q) => s + q.odd, 0) / qs.length).toFixed(2), tipo: 'cotada', casas: [...new Set(qs.map(q => q.casa))], maior: Math.max(...qs.map(q => q.odd)) };
    const temMercado = Number.isFinite(pMercado) && pMercado > 0 && pMercado < 1, p = temMercado ? pMercado : pModelo;
    if (!(p > 0 && p < 1)) return null;
    return { odd: +Math.max(1.01, 1 / (p * (1 + MARGEM_TIPICA + (temMercado ? 0 : 0.02)))).toFixed(2), tipo: temMercado ? 'mercado' : 'modelo', casas: [] };
  }

  G.PCMercado = Object.freeze({ normNome, jogadoresDoResumo, acharJogador, chave, rotulo, familia, meia, doResumo, doPlacar, semMargem, referencia, melhorOdd, oddSugerida, MARGEM_TIPICA });
})(typeof globalThis !== 'undefined' ? globalThis : window);
