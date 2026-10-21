/* Ponto Comum v3 · validacao.js
 * Validação semana a semana: para cada semana, ajusta o modelo só com jogos anteriores e prevê a semana.
 * Parâmetros escolhidos no período de ajuste e conferidos no período de teste (jogos que não participaram do ajuste).
 * Compara com a DraftKings (abertura e fechamento, sem margem), mede a calibração, testa regras de aposta
 * e o filtro das sugestões contra o que aconteceu, e confere os mercados de tempo (2º tempo, tempo com mais gols, 1º gol).
 */
(function (G) {
  'use strict';
  const M = () => G.PCModelo, R = () => G.PCRede;
  const L = q => Math.log(Math.max(1e-12, q));
  const ceder = (() => { if (typeof MessageChannel === 'undefined') return () => new Promise(r => setTimeout(r, 0)); const ch = new MessageChannel(), fila = []; ch.port1.onmessage = () => { const f = fila.shift(); f && f(); }; return () => new Promise(r => { fila.push(r); ch.port2.postMessage(0); }); })();

  async function walkForward(jogos, cfg, { de, ate, comps, passo = 7, onProgress } = {}) {
    const t0 = Date.parse(de), t1 = Date.parse(ate), alvo = jogos.filter(m => m.done && m.hg != null && comps.has(m.comp) && Date.parse(m.date) >= t0 && Date.parse(m.date) < t1);
    const out = []; let ant = null, semana = 0;
    const cfgFit = Object.assign({}, cfg, { esticar: 1 }); // a correção é aplicada depois, para poder ser escolhida sem reajustar
    for (let s = t0; s < t1; s += passo * 864e5) {
      const lote = alvo.filter(m => { const t = Date.parse(m.date); return t >= s && t < s + passo * 864e5; }); if (!lote.length) continue;
      const F = M().ajustarGols(jogos, Object.assign({}, cfgFit, { cutoff: s, init: ant })); ant = F; semana++;
      for (const m of lote) { const p = M().prever(F, m), c = M().paramComp(F, m.comp);
        out.push({ id: m.id, comp: m.comp, data: m.date, eh: p.eh, ea: p.ea, rho: F.rho, frac: F.fracao1T[m.comp] ?? F.fracao1TGeral, bh: c.mu + (m.neutral ? 0 : c.ha), ba: c.mu,
          conhecidos: p.casa.conhecido && p.fora.conhecido && p.casa.n >= 12 && p.fora.n >= 12,
          y: { r: m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2, tg: m.hg + m.ag, btts: m.hg > 0 && m.ag > 0, g1: m.h1 == null ? null : m.h1 + m.a1, pg: m.pg ?? null } }); }
      if (onProgress) onProgress('Semana de ' + new Date(s).toISOString().slice(0, 10) + ' · ' + semana + ' ajustes');
      await ceder();
    }
    return out;
  }
  const lambdas = (x, s) => { const m0 = (x.eh + x.ea) / 2; return [Math.exp(m0 + s * (x.eh - m0)), Math.exp(m0 + s * (x.ea - m0))]; };
  function basicos(lh, la, rho) { const Mx = M().matriz(lh, la, rho, 10); let h = 0, d = 0, a = 0, o25 = 0, bt = 0; for (let i = 0; i < Mx.length; i++) for (let j = 0; j < Mx.length; j++) { const v = Mx[i][j]; if (i > j) h += v; else if (i < j) a += v; else d += v; if (i + j > 2.5) o25 += v; if (i && j) bt += v; } return { h, d, a, o25, bt, M: Mx }; }
  function metricas(preds, { esticar = 1, base = false } = {}) {
    let n = 0, ll = 0, rps = 0, br = 0, lo = 0, lb = 0;
    for (const x of preds) { const [lh, la] = base ? [Math.exp(x.bh), Math.exp(x.ba)] : lambdas(x, esticar), p = basicos(lh, la, base ? 0 : x.rho), v = [p.h, p.d, p.a], oh = [0, 1, 2].map(i => +(x.y.r === i)); n++;
      ll -= L(v[x.y.r]); br += v.reduce((s, q, i) => s + (q - oh[i]) ** 2, 0); rps += ((v[0] - oh[0]) ** 2 + (v[0] + v[1] - oh[0] - oh[1]) ** 2) / 2;
      lo -= x.y.tg > 2.5 ? L(p.o25) : L(1 - p.o25); lb -= x.y.btts ? L(p.bt) : L(1 - p.bt); }
    const r = v => +(v / n).toFixed(4);
    return { n, logLoss1x2: r(ll), rps: r(rps), brier1x2: r(br), logLossOver25: r(lo), logLossAmbas: r(lb) };
  }
  /* Mercados de tempo: gol no 2º tempo (over 0,5), tempo com mais gols (3 vias) e quem marca primeiro (3 vias). */
  function metricasTempo(preds, { esticar = 1, base = false } = {}) {
    let n = 0, t2 = 0, tmg = 0, pg = 0, np = 0;
    for (const x of preds) {
      if (x.y.g1 == null) continue; const [lh, la] = base ? [Math.exp(x.bh), Math.exp(x.ba)] : lambdas(x, esticar), fr = x.frac, g2 = x.y.tg - x.y.g1; n++;
      const p2 = M().prob2T(lh, la, fr, { t: 't2', s: 'o', l: 0.5 }); t2 -= g2 > 0 ? L(p2) : L(1 - p2);
      const tm = M().tempoMaisGols(lh, la, fr); tmg -= L(tm[x.y.g1 > g2 ? '1' : g2 > x.y.g1 ? '2' : 'x']);
      if (x.y.pg) { np++; pg -= L(M().primeiroGol(lh, la)[x.y.pg]); }
    }
    const r = (v, k) => k ? +(v / k).toFixed(4) : null;
    return { n, gol2T: r(t2, n), tempoMaisGols: r(tmg, n), primeiroGol: r(pg, np), nPrimeiroGol: np };
  }
  function confiabilidade(pontos) {
    const b = Array.from({ length: 10 }, () => [0, 0, 0]); for (const [p, y] of pontos) { const i = Math.min(9, Math.floor(p * 10)); b[i][0]++; b[i][1] += p; b[i][2] += y; }
    let ece = 0; const faixas = b.map((x, i) => { if (!x[0]) return null; ece += x[0] / pontos.length * Math.abs(x[1] / x[0] - x[2] / x[0]); return { de: i / 10, ate: (i + 1) / 10, n: x[0], previsto: x[1] / x[0], aconteceu: x[2] / x[0] }; }).filter(Boolean);
    return { erroMedio: ece, faixas };
  }
  const pontos1x2 = (preds, s) => preds.flatMap(x => { const [lh, la] = lambdas(x, s), p = basicos(lh, la, x.rho); return [p.h, p.d, p.a].map((q, k) => [q, x.y.r === k ? 1 : 0]); });

  /* Regras de aposta simuladas (1 unidade por aposta) sobre o 1X2 e o total na linha da DraftKings.
   * pm = modelo, pk = mercado sem margem, odd = preço real daquele momento (abertura ou fechamento). */
  const REGRAS = [
    { id: 'modelo', nome: 'Só o modelo: valor esperado do modelo > 5%', f: (pm, pk, o) => pm * o - 1 > 0.05 },
    { id: 'meio', nome: 'Meio-termo: valor esperado do modelo > 3% e modelo a até 8 p.p. do mercado', f: (pm, pk, o) => pm * o - 1 > 0.03 && Math.abs(pm - pk) <= 0.08 },
    { id: 'consenso', nome: 'Consenso: média de modelo e mercado com valor esperado > 2%', f: (pm, pk, o) => (pm + pk) / 2 * o - 1 > 0.02 }
  ];
  function simularRegras(linhas, momento) {
    return REGRAS.map(rg => { let n = 0, lucro = 0, acertos = 0, somaOdd = 0;
      for (const r of linhas) for (const c of r.cands[momento] || []) if (rg.f(c.pm, c.pk, c.odd)) { n++; somaOdd += c.odd; if (c.y) { acertos++; lucro += c.odd - 1; } else lucro -= 1; }
      return { id: rg.id, nome: rg.nome, n, acertos, oddMedia: n ? +(somaOdd / n).toFixed(2) : null, roi: n ? +(lucro / n).toFixed(3) : null }; });
  }
  /* O filtro das sugestões (modelo e mercado a até 8 p.p., ambos acima do mínimo, times com ≥ 12 jogos) contra o resultado:
   * a chance de consenso das linhas que passam acontece de fato? E quanto renderiam a odd de fechamento? */
  function avaliarFiltro(linhas) {
    const faixas = [[0.25, 0.38, 'Bingo'], [0.38, 0.48, 'Arriscada'], [0.48, 0.60, 'Média'], [0.60, 0.92, 'Segura']];
    return faixas.map(([de, ate, nome]) => { let n = 0, prev = 0, ac = 0, lucro = 0, rej = 0, recAc = 0;
      for (const r of linhas) { if (!r.x.conhecidos) continue; for (const c of r.cands.fechamento || []) { const cons = (c.pm + c.pk) / 2; if (cons < de || cons >= ate) continue;
        if (Math.abs(c.pm - c.pk) > 0.08 || c.pm > 0.92 || c.pk < de - 0.05) { rej++; recAc += c.y; continue; }
        n++; prev += cons; ac += c.y; lucro += c.y ? c.odd - 1 : -1; } }
      return { nivel: nome, de, ate, n, previsto: n ? prev / n : null, aconteceu: n ? ac / n : null, roi: n ? +(lucro / n).toFixed(3) : null, rejeitadas: rej, aconteceuRejeitadas: rej ? recAc / rej : null }; });
  }

  /* Comparação com o mercado (baixa abertura e fechamento da DraftKings de cada jogo; ~40 KB por jogo). */
  async function contraMercado(preds, jogosPorId, s, { onProgress } = {}) {
    const linhas = [], tarefas = preds.map((x, i) => async () => {
      const m = jogosPorId.get(x.id); if (!m) return; let o = null; try { o = await R().carregarOddsFechamento(m); } catch { o = null; }
      if (onProgress && i % 20 === 0) onProgress('Odds da DraftKings · ' + (i + 1) + '/' + preds.length);
      const f = o && o.fechamento; if (!f || !f.h || !f.d || !f.a) return;
      const [lh, la] = lambdas(x, s), p = basicos(lh, la, x.rho), pm3 = [p.h, p.d, p.a], cands = {};
      for (const [w, b] of [['abertura', o.abertura], ['fechamento', f]]) {
        if (!b || !b.h || !b.d || !b.a) continue; const q = G.PCMercado.semMargem([b.h, b.d, b.a]).p, l = [];
        [b.h, b.d, b.a].forEach((odd, k) => l.push({ pm: pm3[k], pk: q[k], odd, y: x.y.r === k ? 1 : 0, t: '1x2' }));
        if (b.over && b.under && G.PCMercado.meia(b.linha)) { const qt = G.PCMercado.semMargem([b.over, b.under]).p; let po = 0; for (let i = 0; i < p.M.length; i++) for (let j = 0; j < p.M.length; j++) if (i + j > b.linha) po += p.M[i][j];
          l.push({ pm: po, pk: qt[0], odd: b.over, y: x.y.tg > b.linha ? 1 : 0, t: 'tot' }, { pm: 1 - po, pk: qt[1], odd: b.under, y: x.y.tg < b.linha ? 1 : 0, t: 'tot' }); }
        cands[w] = l;
      }
      linhas.push({ x, q: G.PCMercado.semMargem([f.h, f.d, f.a]).p, qa: o.abertura && o.abertura.h && o.abertura.d && o.abertura.a ? G.PCMercado.semMargem([o.abertura.h, o.abertura.d, o.abertura.a]).p : null, p: pm3, cands });
    });
    await R().pool(tarefas, 6);
    linhas.sort((a, b) => Date.parse(a.x.data) - Date.parse(b.x.data));
    if (!linhas.length) return null;
    const ll = (rs, f) => rs.reduce((t, r) => t - L(f(r)[r.x.y.r]), 0) / rs.length, mix = w => r => r.p.map((v, i) => w * v + (1 - w) * r.q[i]);
    const metade = Math.floor(linhas.length / 2), A = linhas.slice(0, metade), B = linhas.slice(metade), pesos = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 1];
    const curva = pesos.map(w => ll(A, mix(w))), w = pesos[curva.indexOf(Math.min(...curva))], comAb = linhas.filter(r => r.qa);
    return { n: linhas.length, logLoss: { modelo: +ll(linhas, r => r.p).toFixed(4), mercado: +ll(linhas, r => r.q).toFixed(4), aberturaMercado: comAb.length ? +ll(comAb, r => r.qa).toFixed(4) : null }, pesoModeloNaMistura: w,
      segundaMetade: { modelo: +ll(B, r => r.p).toFixed(4), mercado: +ll(B, r => r.q).toFixed(4), mistura: +ll(B, mix(w)).toFixed(4) },
      regras: { abertura: simularRegras(linhas, 'abertura'), fechamento: simularRegras(linhas, 'fechamento') }, filtroSugestoes: avaliarFiltro(linhas),
      calibracaoMercado: confiabilidade(linhas.flatMap(r => r.q.map((v, k) => [v, r.x.y.r === k ? 1 : 0]))) };
  }

  /* Validação completa. Ajuste nas primeiras semanas, teste nas últimas. Opcionalmente escolhe parâmetros. */
  async function rodar(jogos, { semanasTeste = 14, semanasAjuste = 24, escolherParametros = false, comMercado = false, onProgress = () => {} } = {}) {
    const comps = new Set(R().COMPS.filter(c => c.radar || c.opcional).map(c => c.id)), ultimo = jogos.filter(m => m.done && comps.has(m.comp)).reduce((t, m) => Math.max(t, Date.parse(m.date)), 0);
    const fim = new Date(ultimo + 864e5), corte = new Date(fim - semanasTeste * 7 * 864e5), ini = new Date(corte - semanasAjuste * 7 * 864e5);
    const base = Object.assign({}, M().PADRAO), candidatos = escolherParametros ? [[180, 0.6], [270, 0.3], [270, 0.6], [400, 0.6]].map(([halfLife, sotBlend]) => Object.assign({}, base, { halfLife, sotBlend })) : [base];
    let melhor = null;
    for (const [i, cfg] of candidatos.entries()) {
      const pa = await walkForward(jogos, cfg, { de: ini.toISOString(), ate: corte.toISOString(), comps, onProgress: t => onProgress('Ajuste ' + (i + 1) + '/' + candidatos.length + ' · ' + t) });
      for (const s of [1, 1.1, 1.2, 1.3]) { const mt = metricas(pa, { esticar: s }), nota = mt.logLoss1x2 + mt.logLossOver25 + mt.logLossAmbas; if (!melhor || nota < melhor.nota) melhor = { cfg, esticar: s, nota, ajuste: mt }; }
    }
    onProgress('Teste nas últimas ' + semanasTeste + ' semanas');
    const pt = await walkForward(jogos, melhor.cfg, { de: corte.toISOString(), ate: fim.toISOString(), comps, onProgress: t => onProgress('Teste · ' + t) });
    const rel = { geradoEm: new Date().toISOString(), periodoAjuste: [ini.toISOString().slice(0, 10), corte.toISOString().slice(0, 10)], periodoTeste: [corte.toISOString().slice(0, 10), new Date(ultimo).toISOString().slice(0, 10)],
      parametros: { meiaVida: melhor.cfg.halfLife, pesoChutesNoAlvo: melhor.cfg.sotBlend, correcao: melhor.esticar }, ajuste: melhor.ajuste,
      teste: { modelo: metricas(pt, { esticar: melhor.esticar }), semCorrecao: metricas(pt, { esticar: 1 }), mediaDaLiga: metricas(pt, { base: true }) },
      tempos: { modelo: metricasTempo(pt, { esticar: melhor.esticar }), mediaDaLiga: metricasTempo(pt, { base: true }) },
      calibracao: confiabilidade(pontos1x2(pt, melhor.esticar)), mercado: null };
    if (comMercado) { const porId = new Map(jogos.map(m => [m.id, m])); rel.mercado = await contraMercado(pt, porId, melhor.esticar, { onProgress }); }
    return rel;
  }

  /* Relatório medido em 19–20/10/2026 com a rede completa (30 competições). Os campos marcados como null são
   * preenchidos quando a validação roda neste navegador. */
  const RELATORIO_BASE = {
    geradoEm: '2026-10-19T23:30:00-03:00', fixo: true,
    periodoAjuste: ['2026-01-12', '2026-06-30'], periodoTeste: ['2026-07-01', '2026-10-19'],
    parametros: { meiaVida: 270, pesoChutesNoAlvo: 0.6, correcao: 1.2, desvioClube: 0.36 },
    ajuste: { n: 1486 },
    teste: { modelo: { n: 635, logLoss1x2: 0.9675, logLossOver25: 0.6621, logLossAmbas: 0.6793 }, semCorrecao: { n: 635, logLoss1x2: 0.975, logLossOver25: 0.6642, logLossAmbas: 0.6791 },
      semChutes: { n: 635, logLoss1x2: 0.9784, logLossOver25: 0.6681, logLossAmbas: 0.6824 }, mediaDaLiga: { n: 635, logLoss1x2: 1.0634, logLossOver25: 0.6933, logLossAmbas: 0.6849 } },
    contraModeloAntigo: { n: 460, antigo: { logLoss1x2: 0.9925, logLossOver25: 0.6748, logLossAmbas: 0.6903 }, novo: { logLoss1x2: 0.9903, logLossOver25: 0.6633, logLossAmbas: 0.675 }, coberturaAntigo: 'ele só cobre 72% dos jogos do teste, porque não tem histórico suficiente em Libertadores, Sul-Americana e na fase de liga europeia' },
    janelaCompleta: { periodo: ['2026-01-12', '2026-10-19'], n: 1716, novo: { logLoss1x2: 0.9987, logLossOver25: 0.6756, logLossAmbas: 0.6835 }, antigo: { logLoss1x2: 1.0115, logLossOver25: 0.6852, logLossAmbas: 0.6911 }, mediaDaLiga: { logLoss1x2: 1.0664, logLossOver25: 0.6968, logLossAmbas: 0.6865 } },
    tempos: null,
    mercado: { n: 609, logLoss: { modelo: 0.9725, mercado: 0.9347, aberturaMercado: 0.9449 }, pesoModeloNaMistura: 0, totaisNaLinhaDK: { modelo: 0.6949, mercado: 0.682 },
      derivadasDoMercado: { ambas: [0.6768, 0.6768], over15: [0.5057, 0.5044], over25: [0.6621, 0.6495], over35: [0.6161, 0.6008], gol1T: [0.5986, 0.598], over15_1T: [0.6444, 0.6404] },
      apostasSimuladas: { fechamento: { n: 595, roi: -0.257 }, abertura: { n: 442, roi: -0.355, clv: -0.033, clvMedioGeral: -0.0295 } }, regras: null, filtroSugestoes: null },
    escanteios: { n: 2121, over95: { modelo: 0.708, mediaDaLiga: 0.7434 }, erroMedio: { modelo: 2.78, mediaDaLiga: 2.90 } },
    cartoes: { n: 2120, over45: { modelo: 0.6658, mediaDaLiga: 0.7171 }, erroMedio: { modelo: 1.76, mediaDaLiga: 1.88 } },
    calibracao1x2: { modelo: 0.0272, mercado: 0.0199 },
    cansaco: 'Times com menos de 3,6 dias de descanso não marcaram menos nem sofreram mais, em média, depois de controlar a força (efeito estimado +1,6% e −1,1%). Incluir o efeito não melhorou a previsão.'
  };

  G.PCValidacao = Object.freeze({ walkForward, metricas, metricasTempo, confiabilidade, contraMercado, simularRegras, avaliarFiltro, REGRAS, rodar, RELATORIO_BASE });
})(typeof globalThis !== 'undefined' ? globalThis : window);
