/* Ponto Comum v3 · analise.js
 * Linhas de uma partida com o MODELO na frente e o mercado ao lado.
 * Cada linha: chance do modelo (com faixa), chance do mercado sem margem, odd sugerida (média das casas ou
 * estimada), odd justa do modelo, valor esperado pelo modelo e se modelo e mercado concordam (até 8 p.p.).
 * Linhas principais = as que o Iago usa (1X2, dupla chance, ambas marcam, mais/menos gols). O resto fica em
 * "outras linhas" e só sobe para os destaques quando foge muito do normal da competição.
 */
(function (G) {
  'use strict';
  const M = () => G.PCModelo, K = () => G.PCMercado, R = () => G.PCRede;
  const TOLERANCIA = 0.08;

  function principais() {
    const out = [{ t: '1x2', s: 'h' }, { t: '1x2', s: 'd' }, { t: '1x2', s: 'a' }, { t: 'dc', s: '1x' }, { t: 'dc', s: 'x2' }, { t: 'dc', s: '12' }, { t: 'btts', s: 's' }, { t: 'btts', s: 'n' }];
    for (const l of [0.5, 1.5, 2.5, 3.5, 4.5]) out.push({ t: 'tot', s: 'o', l }, { t: 'tot', s: 'u', l });
    return out;
  }
  function outras() {
    const L = M().LINHAS, out = [];
    for (const l of L.tm) out.push({ t: 'tm', s: 'ho', l }, { t: 'tm', s: 'hu', l }, { t: 'tm', s: 'ao', l }, { t: 'tm', s: 'au', l });
    for (const l of L.ah) out.push({ t: 'ah', s: 'h', l }, { t: 'ah', s: 'a', l });
    for (const l of [0.5, 1.5]) out.push({ t: 't1', s: 'o', l }, { t: 't1', s: 'u', l }, { t: 't2', s: 'o', l }, { t: 't2', s: 'u', l });
    out.push({ t: 'tmg', s: '1' }, { t: 'tmg', s: '2' }, { t: 'tmg', s: 'x' }, { t: 'pg', s: 'h' }, { t: 'pg', s: 'a' }, { t: 'pg', s: '-' });
    for (const l of L.esc) out.push({ t: 'esc', s: 'o', l }, { t: 'esc', s: 'u', l });
    for (const l of L.escT) out.push({ t: 'escT', s: 'ho', l }, { t: 'escT', s: 'hu', l }, { t: 'escT', s: 'ao', l }, { t: 'escT', s: 'au', l });
    for (const l of L.car) out.push({ t: 'car', s: 'o', l }, { t: 'car', s: 'u', l });
    for (const l of L.carT) out.push({ t: 'carT', s: 'ho', l }, { t: 'carT', s: 'hu', l }, { t: 'carT', s: 'ao', l }, { t: 'carT', s: 'au', l });
    return out;
  }
  const CHAVES_PRINCIPAIS = () => new Set(principais().map(mk => K().chave(mk)));

  /* Probabilidade de uma linha dados os gols esperados (lh, la), a matriz de placares e as contagens. */
  function chance(mk, g, frac, esc, car) {
    if (M().doPlacar(mk)) return M().prob(g.M, mk);
    if (mk.t === 't1') return M().prob1T(g.lh, g.la, frac, mk);
    if (mk.t === 't2') return M().prob2T(g.lh, g.la, frac, mk);
    if (mk.t === 'tmg') return M().tempoMaisGols(g.lh, g.la, frac)[mk.s];
    if (mk.t === 'pg') return M().primeiroGol(g.lh, g.la)[mk.s];
    const dir = mk.s.length > 1 ? mk.s[1] : mk.s;
    if (mk.t === 'esc' && esc) return M().probContagem(esc.lh + esc.la, esc.phi, mk.s, mk.l);
    if (mk.t === 'escT' && esc) return M().probContagem(mk.s[0] === 'h' ? esc.lh : esc.la, esc.phi, dir, mk.l);
    if (mk.t === 'car' && car) return M().probContagem(car.lh + car.la, car.phi, mk.s, mk.l);
    if (mk.t === 'carT' && car) return M().probContagem(mk.s[0] === 'h' ? car.lh : car.la, car.phi, dir, mk.l);
    return null;
  }

  /* ctx: { F, Fe, Fc, porTime, forca, cotacoes, resumo, elencos: {casa, fora}, agora } */
  function analisar(m, ctx) {
    const agora = ctx.agora || Date.now(), F = ctx.F, pr = M().prever(F, m), rho = F.rho, frac = F.fracao1T[m.comp] ?? F.fracao1TGeral;
    const modelo = { lh: pr.lh, la: pr.la, M: M().matriz(pr.lh, pr.la, rho) };
    const cot = ctx.cotacoes || [], ref = cot.length ? K().referencia(cot, rho) : null, mercado = ref ? { lh: ref.lh, la: ref.la, M: M().matriz(ref.lh, ref.la, rho) } : null;
    const pe = ctx.Fe ? M().prever(ctx.Fe, m) : null, pc = ctx.Fc ? M().prever(ctx.Fc, m) : null;
    const esc = pe ? { lh: pe.lh, la: pe.la, phi: ctx.Fe.phi } : null, car = pc ? { lh: pc.lh, la: pc.la, phi: ctx.Fc.phi } : null;
    // "Normal da competição": mesmos cálculos com as médias da competição (sem a força dos times).
    const base = (Fx, s) => { if (!Fx) return null; const c = M().paramComp(Fx, m.comp); return { lh: Math.exp(c.mu + (m.neutral ? 0 : c.ha)), la: Math.exp(c.mu), phi: Fx.phi }; };
    const bg = base(F), tipico = { lh: bg.lh, la: bg.la, M: M().matriz(bg.lh, bg.la, rho) }, escTip = base(ctx.Fe), carTip = base(ctx.Fc);
    const lista = principais().concat(outras()), grade = lista.filter(mk => M().doPlacar(mk)), fx = M().faixas(pr, rho, grade, 120);
    const faixa = new Map(grade.map((mk, i) => [K().chave(mk), fx[i]])), princ = CHAVES_PRINCIPAIS();
    const parSemMargem = mk => {
      const oposto = mk.t === 'btts' ? { t: 'btts', s: mk.s === 's' ? 'n' : 's' } : mk.t === 'tot' ? { t: 'tot', s: mk.s === 'o' ? 'u' : 'o', l: mk.l } : mk.t === 'ah' ? { t: 'ah', s: mk.s === 'h' ? 'a' : 'h', l: -mk.l } : null;
      if (!oposto) return null;
      for (const q of cot) if (K().chave(q.mk) === K().chave(mk)) { const o = cot.find(z => z.casa === q.casa && K().chave(z.mk) === K().chave(oposto)); if (o) return K().semMargem([q.odd, o.odd]).p[0]; }
      return null;
    };
    const linhas = [];
    for (const mk of lista) {
      const k = K().chave(mk), pModelo = chance(mk, modelo, frac, esc, car);
      if (!Number.isFinite(pModelo) || pModelo <= 0.002 || pModelo >= 0.998) continue;
      let pMercado = null;
      if (mercado && ['1x2', 'dc', 'btts', 'tot', 'tm', 'ah', 't1', 't2', 'tmg', 'pg'].includes(mk.t)) {
        if (mk.t === '1x2' && ref.x12) pMercado = ref.x12.p[{ h: 0, d: 1, a: 2 }[mk.s]];
        else if (mk.t === 'dc' && ref.x12) { const q = ref.x12.p; pMercado = mk.s === '1x' ? q[0] + q[1] : mk.s === 'x2' ? q[2] + q[1] : q[0] + q[2]; }
        else pMercado = parSemMargem(mk) ?? chance(mk, mercado, frac, null, null);
      }
      if (!Number.isFinite(pMercado)) pMercado = null;
      const os = K().oddSugerida(cot, mk, pMercado, pModelo), div = pMercado !== null ? pModelo - pMercado : null;
      const pTip = chance(mk, tipico, frac, escTip, carTip);
      linhas.push({ mk, chave: k, familia: K().familia(mk), principal: princ.has(k), rotulo: K().rotulo(mk, m.hn, m.an), p: pModelo, pModelo, pMercado, pTipico: Number.isFinite(pTip) ? pTip : null, faixa: faixa.get(k) || null,
        odd: os ? os.odd : null, oddTipo: os ? os.tipo : null, oddCasas: os ? os.casas : [], oddMaior: os && os.maior ? os.maior : null,
        justa: 1 / pModelo, ev: os ? pModelo * os.odd - 1 : null, evMercado: os && pMercado ? pMercado * os.odd - 1 : null, divergencia: div, concorda: div === null ? null : Math.abs(div) <= TOLERANCIA });
    }
    // Destaques: linhas fora das principais com chance alta e bem acima do normal da competição.
    const destaques = linhas.filter(l => !l.principal && !['ah', 'pg', 'tmg'].includes(l.mk.t) && l.p >= 0.68 && l.p <= 0.95 && l.pTipico !== null && l.p - l.pTipico >= 0.15 && l.concorda !== false)
      .sort((a, b) => (b.p - b.pTipico) - (a.p - a.pTipico)).filter((l, i, arr) => arr.findIndex(x => x.mk.t === l.mk.t && x.mk.s === l.mk.s) === i).slice(0, 3);
    const placares = []; for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) placares.push([i, j, modelo.M[i][j]]); placares.sort((a, b) => b[2] - a[2]);
    const cal = { casa: R().calendario(ctx.porTime, m.h, m.date), fora: R().calendario(ctx.porTime, m.a, m.date) };
    const forma = { casa: R().forma(ctx.porTime, m.h, m.date), fora: R().forma(ctx.porTime, m.a, m.date) }, h2h = R().confrontos(ctx.porTime, m.h, m.a, m.date);
    const fc = ctx.forca ? ctx.forca.porId.get(m.h) : null, ff = ctx.forca ? ctx.forca.porId.get(m.a) : null;
    // Quem pode marcar: chance do modelo + odd da Bet365 (quando publicada). Junta os 4 mais prováveis pelo modelo e os 3
    // favoritos do mercado que estão no elenco de cada time.
    const el = ctx.elencos || {}, oj = ctx.resumo && ctx.resumo.jogadores, jogadores = {};
    for (const [lado, lam] of [['casa', pr.lh], ['fora', pr.la]]) {
      const todos = M().artilheiros(el[lado], lam, { max: 60 }), mercado = oj ? oj.qualquer : [];
      const daCasa = mercado.map(x => ({ x, j: K().acharJogador(todos, x.nome) || (el[lado] && K().acharJogador(el[lado].atual, x.nome) ? { nome: x.nome, p: null } : null) })).filter(z => z.j).sort((a, b) => a.x.odd - b.x.odd).slice(0, 3).map(z => z.j);
      const lista = [...todos.slice(0, 4)]; for (const j of daCasa) if (!lista.includes(j) && !lista.some(z => z.nome === j.nome)) lista.push(j);
      jogadores[lado] = lista.map(j => { const q = K().acharJogador(mercado, j.nome); return Object.assign({}, j, { odd: q ? q.odd : null, ev: q && j.p ? j.p * q.odd - 1 : null }); }).sort((a, b) => (b.p ?? 0) - (a.p ?? 0));
    }
    jogadores.casaOdds = oj ? oj.casa : null;
    const alertas = [], x12 = linhas.filter(l => l.mk.t === '1x2' && l.divergencia !== null), maxDiv = x12.reduce((b, l) => Math.abs(l.divergencia) > Math.abs(b ? b.divergencia : 0) ? l : b, null);
    if (maxDiv && Math.abs(maxDiv.divergencia) >= TOLERANCIA) alertas.push({ tipo: 'divergencia', texto: 'Modelo e mercado divergem ' + Math.round(Math.abs(maxDiv.divergencia) * 100) + ' p.p. em "' + maxDiv.rotulo + '" (modelo ' + Math.round(maxDiv.pModelo * 100) + '%, mercado ' + Math.round(maxDiv.pMercado * 100) + '%). Nos testes, quando os dois discordaram assim, o mercado acertou mais: confira escalações e desfalques. As sugestões automáticas não usam linhas divergentes.' });
    for (const [lado, t, nome] of [['casa', pr.casa, m.hn], ['fora', pr.fora, m.an]]) {
      if (!t.conhecido) alertas.push({ tipo: 'dados', texto: nome + ' não tem jogos na rede: a força dele é a média da competição.' });
      else if (t.n < 15) alertas.push({ tipo: 'dados', texto: nome + ' tem só ' + t.n + ' jogos na rede; a estimativa dele é instável.' });
      const c = cal[lado];
      if (c.descanso !== null && c.descanso < 3.5) alertas.push({ tipo: 'calendario', texto: nome + ' jogou há ' + c.descanso.toFixed(1).replace('.', ',') + ' dias' + (c.jogos14 >= 4 ? ' (' + c.jogos14 + ' jogos em 14 dias)' : '') + '.' });
      if (c.ateProximo !== null && c.ateProximo < 3.6) { const p = c.proximos[0], comp = R().COMP_MAP[p.comp]; alertas.push({ tipo: 'calendario', texto: nome + ' volta a jogar em ' + c.ateProximo.toFixed(1).replace('.', ',') + ' dias (' + (comp ? comp.nome : p.comp) + '): risco de poupar titulares.' }); }
    }
    if (!ref) alertas.push({ tipo: 'mercado', texto: 'Sem cotação para esta partida: as odds sugeridas são estimadas pelo modelo com a margem típica das casas.' });
    if (ctx.resumo && ctx.resumo.escalacoes && ctx.resumo.escalacoes.some(e => e.titulares.length >= 11)) alertas.push({ tipo: 'escalacao', texto: 'Escalações confirmadas pela fonte. O modelo não as usa; o mercado já reage a elas.' });
    const iniciado = Date.parse(m.date) <= agora || m.state === 'in' || m.done;
    return { m, iniciado, lh: pr.lh, la: pr.la, rho, frac, pred: pr, ref, linhas, destaques, jogadores, placares: placares.slice(0, 6), escanteios: esc, cartoes: car,
      calendario: cal, forma, h2h, forca: { casa: fc || null, fora: ff || null }, resumo: ctx.resumo || null, alertas, cotacoes: cot, geradoEm: new Date(agora).toISOString() };
  }

  G.PCAnalise = Object.freeze({ analisar, principais, outras, chance, TOLERANCIA });
})(typeof globalThis !== 'undefined' ? globalThis : window);
