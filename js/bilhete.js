/* Ponto Comum v3 · bilhete.js
 * Você escolhe as linhas; o bilhete já traz a odd sugerida de cada uma (editável) e calcula a chance conjunta
 * pelo modelo e pelo mercado, a odd combinada e o valor esperado.
 * Mesmo jogo: chance pela interseção dos placares; a odd do bloco é estimada como a de um "criar aposta".
 * Sugestões automáticas em quatro níveis: segura, média, arriscada e bingo.
 */
(function (G) {
  'use strict';
  const M = () => G.PCModelo;
  const CHAVE = 'pc3-bilhete', MARGEM_CRIAR_APOSTA = 0.10;
  const ler = () => { try { const v = JSON.parse(localStorage.getItem(CHAVE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const gravar = pernas => { try { localStorage.setItem(CHAVE, JSON.stringify(pernas)); } catch { /* bilhete só nesta aba */ } };
  let pernas = ler();

  function deLinha(a, l, nivel = null) {
    return { id: a.m.id + '|' + l.chave, jogoId: a.m.id, comp: a.m.comp, jogo: a.m.hn + ' × ' + a.m.an, inicio: a.m.date, mk: l.mk, rotulo: l.rotulo, familia: l.familia,
      p: l.p, pModelo: l.pModelo, pMercado: l.pMercado, odd: l.odd, oddTipo: l.oddTipo, oddManual: null, nivel, adicionadaEm: new Date().toISOString() };
  }
  function adicionar(a, l) { const p = deLinha(a, l); if (!pernas.some(x => x.id === p.id)) { pernas.push(p); gravar(pernas); } return pernas.slice(); }
  function remover(id) { pernas = pernas.filter(p => p.id !== id); gravar(pernas); return pernas.slice(); }
  function limpar() { pernas = []; gravar(pernas); return []; }
  function definirOdd(id, odd) { const p = pernas.find(x => x.id === id); if (p) { p.oddManual = Number.isFinite(odd) && odd > 1 ? odd : null; gravar(pernas); } return pernas.slice(); }
  function substituir(lista) { pernas = lista.map(p => Object.assign({}, p)); gravar(pernas); return pernas.slice(); }
  const lista = () => pernas.slice();
  const oddDe = p => p.oddManual || p.odd || null;
  const produto = xs => xs.reduce((s, v) => s * v, 1);

  /* analises: Map(jogoId → análise atual), usada para a dependência entre linhas do mesmo jogo. */
  function avaliar(lst = pernas, analises = new Map()) {
    const grupos = new Map(); for (const p of lst) { let g = grupos.get(p.jogoId); if (!g) grupos.set(p.jogoId, g = []); g.push(p); }
    let pMod = 1, pMer = 1, mercadoCompleto = true, odd = 1, oddCompleta = true, estimada = false; const avisos = [], blocos = [];
    for (const [jogoId, g] of grupos) {
      const a = analises.get(jogoId), placar = g.filter(p => M().doPlacar(p.mk)), outras = g.filter(p => !M().doPlacar(p.mk));
      let bMod = 1, bMer = 1, bOdd = 1, blocoMer = true;
      if (placar.length > 1 && a) {
        const rho = Number.isFinite(a.rho) ? a.rho : -0.03, MM = M().matriz(a.lh, a.la, rho), mks = placar.map(p => p.mk), jm = M().probConjunta(MM, mks), margM = mks.map(mk => M().prob(MM, mk));
        if (jm < 1e-6) avisos.push({ nivel: 'erro', texto: a.m.hn + ' × ' + a.m.an + ': as seleções se contradizem (nenhum placar satisfaz todas).' });
        else if (Math.abs(jm - Math.min(...margM)) < 1e-6) avisos.push({ nivel: 'aviso', texto: a.m.hn + ' × ' + a.m.an + ': uma seleção já implica a outra; a perna extra não muda a chance.' });
        bMod = jm;
        if (a.ref && placar.every(p => Number.isFinite(p.pMercado))) { const MR = M().matriz(a.ref.lh, a.ref.la, rho), jr = M().probConjunta(MR, mks), fator = jr / produto(mks.map(mk => M().prob(MR, mk))); bMer = jr < 1e-6 ? 0 : Math.min(fator * produto(placar.map(p => p.pMercado)), ...placar.map(p => p.pMercado)); }
        else blocoMer = false;
        const pOdd = blocoMer ? bMer : bMod; bOdd = pOdd > 0 ? 1 / (pOdd * (1 + MARGEM_CRIAR_APOSTA)) : null; estimada = true;
        avisos.push({ nivel: 'info', texto: a.m.hn + ' × ' + a.m.an + ': pernas do mesmo jogo têm odd própria na casa ("criar aposta"); a odd deste bloco (' + (bOdd ? bOdd.toFixed(2).replace('.', ',') : '—') + ') é estimada pela chance conjunta com margem de 10%.' });
      } else {
        for (const p of placar) { bMod *= p.pModelo ?? p.p; if (Number.isFinite(p.pMercado)) bMer *= p.pMercado; else blocoMer = false; const o = oddDe(p); if (o) bOdd *= o; else oddCompleta = false; }
        if (placar.length > 1) avisos.push({ nivel: 'aviso', texto: g[0].jogo + ': análise do jogo indisponível; pernas multiplicadas como se fossem independentes.' });
      }
      for (const p of outras) { bMod *= p.pModelo ?? p.p; if (Number.isFinite(p.pMercado)) bMer *= p.pMercado; else blocoMer = false; const o = oddDe(p); if (o && bOdd) bOdd *= o; else oddCompleta = false; }
      if (outras.length && g.length > 1) avisos.push({ nivel: 'info', texto: g[0].jogo + ': escanteios, cartões e tempos entram como independentes dos gols do mesmo jogo (aproximação).' });
      if (!bOdd) oddCompleta = false;
      pMod *= bMod; if (blocoMer) pMer *= bMer; else mercadoCompleto = false; if (bOdd) odd *= bOdd;
      blocos.push({ jogoId, jogo: g[0].jogo, pernas: g, pModelo: bMod, pMercado: blocoMer ? bMer : null, odd: bOdd });
    }
    if (grupos.size > 1) avisos.push({ nivel: 'info', texto: 'Entre jogos diferentes, as chances são multiplicadas (independência).' });
    const estimadas = lst.filter(p => !p.oddManual && p.oddTipo && p.oddTipo !== 'cotada').length;
    if (estimadas) avisos.push({ nivel: 'info', texto: estimadas + ' perna(s) com odd estimada (sem cotação na fonte). Confira e corrija com a odd da sua casa, se quiser.' });
    const divergentes = lst.filter(p => Number.isFinite(p.pMercado) && Math.abs((p.pModelo ?? p.p) - p.pMercado) > 0.08);
    if (divergentes.length) avisos.push({ nivel: 'aviso', texto: divergentes.length + ' perna(s) em que modelo e mercado divergem mais de 8 p.p.: ' + divergentes.map(p => p.rotulo).join('; ') + '. Nos testes, nessas divergências o mercado acertou mais.' });
    const oddT = lst.length && oddCompleta ? odd : null, pM = lst.length ? pMod : null, pK = lst.length && mercadoCompleto ? pMer : null;
    return { n: lst.length, jogos: grupos.size, pModelo: pM, pMercado: pK, odd: oddT, oddEstimada: estimada, justa: pM ? 1 / pM : null,
      ev: oddT && pM ? pM * oddT - 1 : null, evMercado: oddT && pK ? pK * oddT - 1 : null, blocos, avisos };
  }

  /* Sugestões. Filtro "meio-termo" por perna: chance do modelo ≥ mínimo do nível; se há mercado, modelo e mercado
   * a até 8 p.p. e mercado ≥ mínimo − 5 p.p.; os dois times com ≥ 12 jogos na rede; uma perna por jogo; só pré-jogo. */
  const NIVEIS = Object.freeze([
    { id: 'segura', nome: 'Segura', minP: 0.60, pernas: [2, 4], odd: [2.4, 4.5] },
    { id: 'media', nome: 'Média', minP: 0.48, pernas: [3, 6], odd: [9, 12] },
    { id: 'arriscada', nome: 'Arriscada', minP: 0.38, pernas: [4, 8], odd: [15, 50] },
    { id: 'bingo', nome: 'Bingo', minP: 0.25, pernas: [5, 12], odd: [100, 1500] }
  ]);
  const PREF_PADRAO = Object.freeze({ '1x2': true, dc: true, btts_s: true, btts_n: false, tot: true, tm: false, ah: false, tempos: false, esc: false, car: false });
  function permitido(l, pref) {
    const t = l.mk.t; if (t === 'btts') return l.mk.s === 's' ? pref.btts_s : pref.btts_n;
    if (['t1', 't2', 'tmg', 'pg'].includes(t)) return !!pref.tempos;
    if (t === 'escT') return !!pref.esc; if (t === 'carT') return !!pref.car;
    return !!pref[t];
  }
  const consenso = l => Number.isFinite(l.pMercado) ? (l.pModelo + l.pMercado) / 2 : l.pModelo;
  function sugerir(analises, pref = PREF_PADRAO) {
    const porJogo = [];
    for (const a of analises) {
      if (a.iniciado || !a.pred || !a.pred.casa.conhecido || !a.pred.fora.conhecido || a.pred.casa.n < 12 || a.pred.fora.n < 12) continue;
      const cand = a.linhas.filter(l => l.odd && permitido(l, pref) && l.pModelo <= 0.92 && (l.pMercado === null || (Math.abs(l.pModelo - l.pMercado) <= 0.08)));
      if (cand.length) porJogo.push({ a, cand });
    }
    return NIVEIS.map(nv => {
      // Programação dinâmica: para cada número de pernas e faixa de odd (em escala log), guarda a combinação de maior
      // chance (média de modelo e mercado). Uma perna por jogo. Para a mesma odd, menos pernas costuma dar mais chance,
      // porque a margem da casa se acumula a cada perna.
      const grupos = porJogo.map(g => ({ a: g.a, ls: g.cand.filter(l => l.pModelo >= nv.minP && (l.pMercado === null || l.pMercado >= nv.minP - 0.05)) })).filter(g => g.ls.length);
      let estados = new Map([['0|0', { p: 1, odd: 1, k: 0, pernas: [] }]]);
      for (const g of grupos) {
        const novos = new Map(estados);
        for (const st of estados.values()) {
          if (st.k >= nv.pernas[1]) continue;
          for (const l of g.ls) {
            const odd = st.odd * l.odd; if (odd > nv.odd[1] * 1.0001) continue;
            const p = st.p * consenso(l), k = st.k + 1, chave = k + '|' + Math.round(Math.log(odd) * 60), v = novos.get(chave);
            if (!v || p > v.p) novos.set(chave, { p, odd, k, pernas: st.pernas.concat([{ a: g.a, l }]) });
          }
        }
        estados = novos;
      }
      let melhor = null;
      for (const st of estados.values()) if (st.k >= nv.pernas[0] && st.odd >= nv.odd[0] && st.odd <= nv.odd[1] * 1.0001 && (!melhor || st.p > melhor.p)) melhor = st;
      if (!melhor) return { nivel: nv, disponivel: false, motivo: grupos.length < nv.pernas[0] ? 'Poucos jogos analisados passam no filtro deste nível (' + grupos.length + '; precisa de ' + nv.pernas[0] + ').' : 'Nenhuma combinação dos jogos analisados chega à faixa de odd ' + String(nv.odd[0]).replace('.', ',') + '–' + String(nv.odd[1]).replace('.', ',') + ' com o filtro deste nível.' };
      const ps = melhor.pernas.map(x => deLinha(x.a, x.l, nv.id)), pMer = ps.every(p => Number.isFinite(p.pMercado)) ? produto(ps.map(p => p.pMercado)) : null, pMod = produto(ps.map(p => p.pModelo));
      return { nivel: nv, disponivel: true, pernas: ps, odd: melhor.odd, pModelo: pMod, pMercado: pMer, ev: pMod * melhor.odd - 1, evMercado: pMer ? pMer * melhor.odd - 1 : null, estimadas: ps.filter(p => p.oddTipo !== 'cotada').length };
    });
  }

  G.PCBilhete = Object.freeze({ lista, adicionar, remover, limpar, definirOdd, substituir, avaliar, sugerir, NIVEIS, PREF_PADRAO, oddDe, deLinha });
})(typeof globalThis !== 'undefined' ? globalThis : window);
