/* Ponto Comum v3 · diario.js
 * Diário de previsões e apostas. Grava as linhas principais antes do jogo, apura pelo placar da ESPN,
 * mede a calibração (modelo e mercado) e o CLV (odd da DraftKings na captura ÷ odd de fechamento − 1).
 * Apostas reais: valor, odd que você pegou, nível (segura, média, arriscada, bingo) e lucro.
 * Fica no IndexedDB deste navegador; exporte para levar a outro.
 */
(function (G) {
  'use strict';
  const R = () => G.PCRede, M = () => G.PCModelo, K = () => G.PCMercado;
  const PRINCIPAIS = [{ t: '1x2', s: 'h' }, { t: '1x2', s: 'd' }, { t: '1x2', s: 'a' }, { t: 'dc', s: '1x' }, { t: 'dc', s: 'x2' }, { t: 'dc', s: '12' }, { t: 'btts', s: 's' }, { t: 'btts', s: 'n' },
    { t: 'tot', s: 'o', l: 1.5 }, { t: 'tot', s: 'u', l: 1.5 }, { t: 'tot', s: 'o', l: 2.5 }, { t: 'tot', s: 'u', l: 2.5 }, { t: 'tot', s: 'o', l: 3.5 }, { t: 'tot', s: 'u', l: 3.5 },
    { t: 't1', s: 'o', l: 0.5 }, { t: 't2', s: 'o', l: 0.5 }, { t: 'pg', s: 'h' }, { t: 'pg', s: 'a' }, { t: 'esc', s: 'o', l: 9.5 }, { t: 'car', s: 'o', l: 4.5 }];
  const chavesPrincipais = new Set(PRINCIPAIS.map(mk => K().chave(mk)));

  async function todos() { return (await R().kv.all('diario')).map(([, v]) => v).sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio)); }
  const salvar = r => R().kv.put('diario', r.id, r);

  /* Linhas principais de uma análise pré-jogo. A primeira captura guarda a odd da DraftKings para o CLV. */
  async function capturar(a) {
    if (a.iniciado) return 0; let n = 0; const agora = new Date().toISOString();
    for (const l of a.linhas) {
      if (!chavesPrincipais.has(l.chave)) continue;
      const id = 'p|' + a.m.id + '|' + l.chave, velho = await R().kv.get('diario', id);
      const dk = (a.cotacoes || []).find(q => /draftkings/i.test(q.casa) && K().chave(q.mk) === l.chave);
      const r = Object.assign({}, velho || {}, { id, tipo: 'previsao', jogoId: a.m.id, comp: a.m.comp, inicio: a.m.date, casaNome: a.m.hn, foraNome: a.m.an, mk: l.mk, chave: l.chave, familia: l.familia, rotulo: l.rotulo,
        p: l.pModelo, pModelo: l.pModelo, pMercado: l.pMercado, odd: l.odd, oddTipo: l.oddTipo, atualizadoEm: agora,
        primeiraEm: velho ? velho.primeiraEm : agora, oddDK: velho && velho.oddDK ? velho.oddDK : (dk ? dk.odd : null), versaoModelo: '3' });
      await salvar(r); n++;
    }
    return n;
  }
  /* Bilhete salvo: modo 'aposta' (valor e odd que você pegou) ou 'acompanhar'. */
  async function salvarBilhete(pernas, av, { modo = 'acompanhar', valor = null, oddPega = null, nivel = null } = {}) {
    const agora = new Date().toISOString(), id = 'b|' + Date.now().toString(36);
    const r = { id, tipo: 'bilhete', modo, nivel: nivel || pernas.find(p => p.nivel)?.nivel || null, valor: Number.isFinite(valor) && valor > 0 ? valor : null, criadoEm: agora, inicio: pernas.map(p => p.inicio).sort()[0],
      pernas: pernas.map(p => ({ jogoId: p.jogoId, comp: p.comp, jogo: p.jogo, inicio: p.inicio, mk: p.mk, rotulo: p.rotulo, p: p.pModelo ?? p.p, pMercado: p.pMercado ?? null, odd: G.PCBilhete.oddDe(p), oddTipo: p.oddManual ? 'informada' : p.oddTipo })),
      pModelo: av.pModelo, pMercado: av.pMercado, oddSugerida: av.odd, odd: Number.isFinite(oddPega) && oddPega > 1 ? oddPega : av.odd, ev: av.ev };
    await salvar(r); return r;
  }
  async function remover(id) { await R().kv.del('diario', id); }

  function liquidar(mk, j) {
    const t = mk.t;
    if (M().doPlacar(mk)) return j.hg == null ? null : M().vence(mk, j.hg, j.ag) ? 1 : 0;
    if (t === 't1' || t === 't2' || t === 'tmg') {
      if (j.h1 == null || j.hg == null) return null; const g1 = j.h1 + j.a1, g2 = j.hg + j.ag - g1;
      if (t === 'tmg') return (mk.s === '1' ? g1 > g2 : mk.s === '2' ? g2 > g1 : g1 === g2) ? 1 : 0;
      const g = t === 't1' ? g1 : g2; return (mk.s === 'o' ? g > mk.l : g < mk.l) ? 1 : 0;
    }
    if (t === 'pg') return j.pg == null ? null : j.pg === mk.s ? 1 : 0;
    const par = t.startsWith('esc') ? [j.hc, j.ac] : t.startsWith('car') ? [j.hy == null ? null : j.hy + (j.hr || 0), j.ay == null ? null : j.ay + (j.ar || 0)] : null;
    if (!par || par[0] == null || par[1] == null) return null;
    const v = t === 'esc' || t === 'car' ? par[0] + par[1] : mk.s[0] === 'h' ? par[0] : par[1], over = t === 'esc' || t === 'car' ? mk.s === 'o' : mk.s[1] === 'o';
    return (over ? v > mk.l : v < mk.l) ? 1 : 0;
  }

  /* Apura o que já terminou. resultados: Map(jogoId → jogo da rede). Busca o fechamento da DraftKings para o CLV. */
  async function apurar(resultados, { onProgress = () => {} } = {}) {
    const lista = await todos(), agora = Date.now(); let apurados = 0, clv = 0;
    const pend = lista.filter(r => !r.apurado && Date.parse(r.inicio) + 2.5 * 3600e3 < agora), fechamento = new Map();
    for (const [i, r] of pend.entries()) {
      onProgress(i + 1, pend.length);
      if (r.tipo === 'previsao') {
        const j = resultados.get(r.jogoId); if (!j || !j.done) continue;
        const y = liquidar(r.mk, j); if (y === null) { r.apurado = 'sem-dado'; await salvar(r); continue; }
        r.resultado = y; r.placar = [j.hg, j.ag]; r.apurado = new Date().toISOString();
        if ((r.mk.t === '1x2' || r.mk.t === 'tot') && r.oddDK) {
          if (!fechamento.has(r.jogoId)) { try { fechamento.set(r.jogoId, await R().carregarOddsFechamento(j)); } catch { fechamento.set(r.jogoId, null); } }
          const f = fechamento.get(r.jogoId), fc = f && f.fechamento;
          if (fc) { const o = r.mk.t === '1x2' ? fc[r.mk.s] : (fc.linha === r.mk.l ? (r.mk.s === 'o' ? fc.over : fc.under) : null); if (o) { r.oddFechamento = o; r.clv = r.oddDK / o - 1; clv++; } }
        }
        await salvar(r); apurados++;
      } else if (r.tipo === 'bilhete') {
        let todasOk = true, ganhou = true;
        for (const p of r.pernas) { const j = resultados.get(p.jogoId); const y = j && j.done ? liquidar(p.mk, j) : null; p.resultado = y; if (y === null) todasOk = false; else if (!y) ganhou = false; }
        if (!todasOk && ganhou) { await salvar(r); continue; }
        r.resultado = ganhou && todasOk ? 1 : 0; r.apurado = new Date().toISOString();
        if (r.modo === 'aposta' && r.valor && r.odd) r.lucro = r.valor * (r.resultado ? r.odd - 1 : -1);
        await salvar(r); apurados++;
      }
    }
    return { apurados, comClv: clv, pendentes: pend.length - apurados };
  }

  const L = p => Math.log(Math.min(1 - 1e-9, Math.max(1e-9, p)));
  function metricas(lista) {
    const prev = lista.filter(r => r.tipo === 'previsao' && r.apurado && (r.resultado === 0 || r.resultado === 1));
    const grupo = rs => { const n = rs.length; if (!n) return null; let b = 0, ll = 0, ac = 0, pm = 0, nk = 0, llk = 0;
      for (const r of rs) { const p = r.pModelo ?? r.p; b += (p - r.resultado) ** 2; ll -= r.resultado ? L(p) : L(1 - p); ac += r.resultado; pm += p; if (Number.isFinite(r.pMercado)) { nk++; llk -= r.resultado ? L(r.pMercado) : L(1 - r.pMercado); } }
      return { n, previsto: pm / n, aconteceu: ac / n, brier: b / n, logLoss: ll / n, logLossMercado: nk ? llk / nk : null, nMercado: nk }; };
    const porFamilia = {}; for (const f of ['resultado', 'gols', 'tempos', 'escanteios', 'cartoes']) porFamilia[f] = grupo(prev.filter(r => r.familia === f));
    const faixas = Array.from({ length: 10 }, (_, i) => { const rs = prev.filter(r => Math.min(9, Math.floor((r.pModelo ?? r.p) * 10)) === i); return rs.length ? { de: i / 10, ate: (i + 1) / 10, n: rs.length, previsto: rs.reduce((s, r) => s + (r.pModelo ?? r.p), 0) / rs.length, aconteceu: rs.reduce((s, r) => s + r.resultado, 0) / rs.length } : null; }).filter(Boolean);
    const comClv = prev.filter(r => Number.isFinite(r.clv)), bil = lista.filter(r => r.tipo === 'bilhete'), apostas = bil.filter(r => r.modo === 'aposta');
    const porNivel = {}; for (const r of apostas) { const k = r.nivel || 'manual', x = porNivel[k] || (porNivel[k] = { apostas: 0, apuradas: 0, ganhas: 0, investido: 0, lucro: 0 }); x.apostas++; if (r.apurado) { x.apuradas++; x.ganhas += r.resultado ? 1 : 0; x.investido += r.valor || 0; x.lucro += r.lucro || 0; } }
    const apuradas = apostas.filter(r => r.apurado), investido = apuradas.reduce((s, r) => s + (r.valor || 0), 0), lucro = apuradas.reduce((s, r) => s + (r.lucro || 0), 0);
    return { total: lista.length, previsoes: lista.filter(r => r.tipo === 'previsao').length, apuradas: prev.length, porFamilia, faixas,
      clv: comClv.length ? { n: comClv.length, medio: comClv.reduce((s, r) => s + r.clv, 0) / comClv.length, positivos: comClv.filter(r => r.clv > 0).length } : null,
      bilhetes: { total: bil.length, acompanhados: bil.filter(r => r.modo !== 'aposta').length, apostas: apostas.length, apuradas: apuradas.length, ganhas: apuradas.filter(r => r.resultado).length, pendentes: apostas.length - apuradas.length, investido, lucro, roi: investido ? lucro / investido : null, porNivel } };
  }

  /* Revisão jogo a jogo: o que o hub disse (as linhas preferidas mais prováveis entre 55% e 88%) e o que aconteceu. */
  function revisao(lista, { max = 40 } = {}) {
    const porJogo = new Map();
    for (const r of lista) if (r.tipo === 'previsao' && r.apurado && (r.resultado === 0 || r.resultado === 1)) { let g = porJogo.get(r.jogoId); if (!g) porJogo.set(r.jogoId, g = []); g.push(r); }
    return [...porJogo.values()].map(rs => {
      const r0 = rs[0], pref = rs.filter(r => ['1x2', 'dc', 'btts', 'tot'].includes(r.mk.t) && !(r.mk.t === 'btts' && r.mk.s === 'n') && (r.pModelo ?? r.p) >= 0.55 && (r.pModelo ?? r.p) <= 0.88);
      const porTipo = new Map(); for (const r of pref.sort((x, y) => (y.pModelo ?? y.p) - (x.pModelo ?? x.p))) if (!porTipo.has(r.mk.t)) porTipo.set(r.mk.t, r);
      const ditas = [...porTipo.values()], x12 = ['h', 'd', 'a'].map(s => rs.find(r => r.mk.t === '1x2' && r.mk.s === s)).filter(Boolean);
      const fav = x12.length === 3 ? x12.reduce((b, r) => ((r.pModelo ?? r.p) > (b.pModelo ?? b.p) ? r : b)) : null;
      return { jogoId: r0.jogoId, jogo: r0.casaNome + ' × ' + r0.foraNome, inicio: r0.inicio, comp: r0.comp, placar: r0.placar, ditas, acertos: ditas.filter(r => r.resultado).length,
        favorito: fav ? { rotulo: fav.rotulo, p: fav.pModelo ?? fav.p, pMercado: fav.pMercado, aconteceu: fav.resultado } : null };
    }).sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio)).slice(0, max);
  }

  async function exportar() { return JSON.stringify({ formato: 'ponto-comum-diario', versao: 3, exportadoEm: new Date().toISOString(), registros: await todos() }, null, 1); }
  async function importar(texto) {
    const d = JSON.parse(texto); if (!d || d.formato !== 'ponto-comum-diario' || !Array.isArray(d.registros)) throw new Error('Arquivo não é um diário do Ponto Comum.');
    let n = 0; for (const r of d.registros) { if (!r || typeof r.id !== 'string' || !/^[pb]\|/.test(r.id) || !r.inicio) continue; if (!(await R().kv.get('diario', r.id))) { await salvar(Object.assign({}, r, { importado: true })); n++; } }
    return n;
  }

  G.PCDiario = Object.freeze({ PRINCIPAIS, todos, capturar, salvarBilhete, remover, apurar, metricas, revisao, exportar, importar, liquidar });
})(typeof globalThis !== 'undefined' ? globalThis : window);
