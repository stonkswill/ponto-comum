/* Ponto Comum v3 · modelo.js
 * Modelo de força conjunto para todos os clubes e competições da rede.
 *   log λ(mandante) = μ[competição] + mando[competição] + nível[liga do mandante] + ataque[mandante] − defesa_nível[liga do visitante] − defesa[visitante]
 * - Clubes de ligas diferentes ficam comparáveis pelos jogos de copas e torneios continentais.
 * - Recência: peso exp(−ln2 · idade / meia-vida). Copas pesam 0,8; estaduais, 0,6.
 * - Força medida com 60% chutes no alvo (convertidos em gols) + 40% gols: menos ruído que só gols. Nos jogos com odds de
 *   fechamento, metade do alvo vem dos gols esperados implícitos nesse preço (ainda menos ruído).
 * - Dixon-Coles (ρ) corrige placares baixos. Correção de confiança (1,2) validada fora da amostra.
 * Escanteios e cartões usam a mesma estrutura, com binomial negativa para a dispersão.
 */
(function (G) {
  'use strict';
  const LN2 = Math.LN2, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const COMP = () => G.PCRede.COMP_MAP;

  // Meia-vida, chutes e correção escolhidos no ajuste (jan–jul/2026) e conferidos no teste (jul–out/2026).
  // Em 22/10, com a base real: forças mais espalhadas (0,5) e 50% de gols esperados do fechamento do mercado nos jogos
  // passados (mktBlend) baixaram o log loss 1X2 do teste de 0,9743 para 0,9683, sem piorar o ajuste.
  const PADRAO = Object.freeze({ halfLife: 270, sdTeam: 0.5, sdLeague: 0.45, sdHome: 0.15, haPrior: 0.25, sotBlend: 0.6, cupW: 0.8, stateW: 0.6,
    iters: 80, tol: 2e-5, maxAgeDays: 1100, embargoH: 3, esticar: 1.2, mktBlend: 0.5 });
  const PADRAO_CONTAGEM = Object.freeze(Object.assign({}, PADRAO, { sotBlend: 0, sdTeam: 0.3, esticar: 1, mktBlend: 0 }));

  function grupoDe(comp) { const c = COMP()[comp]; return !c ? 'O:?' : c.tipo === 'league' ? 'L:' + comp : 'O:' + c.regiao; }

  function selecionar(jogos, o, alvo) {
    const tw = { league: 1, continental: 1, cup: o.cupW, state: o.stateW }, M = [], W = [], Y = [];
    for (const m of jogos) {
      if (!m.done) continue; const y = alvo(m); if (!y) continue;
      const t = Date.parse(m.date); if (!(t + o.embargoH * 3600e3 <= o.cutoff)) continue;
      const idade = (o.cutoff - t) / 864e5; if (idade > o.maxAgeDays) continue;
      const c = COMP()[m.comp]; if (!c) continue;
      const w = (tw[c.tipo] ?? 0.8) * Math.exp(-LN2 * idade / o.halfLife); if (w < 1e-3) continue;
      M.push(m); W.push(w); Y.push(y);
    }
    return { M, W, Y };
  }

  /* Núcleo: Poisson hierárquico penalizado, por blocos de Newton. */
  function nucleo(R, YH, YA, o) {
    const N = R.M.length, gScore = new Map();
    const addG = (t, g, w) => { let s = gScore.get(t); if (!s) gScore.set(t, s = new Map()); s.set(g, (s.get(g) || 0) + w); };
    for (let k = 0; k < N; k++) { const m = R.M[k], g = grupoDe(m.comp), mult = g[0] === 'L' ? 10 : 1; addG(m.h, g, R.W[k] * mult); addG(m.a, g, R.W[k] * mult); }
    const teams = [...gScore.keys()], teamIdx = new Map(teams.map((t, i) => [t, i])), groups = [], gIdx = new Map(), TG = new Int32Array(teams.length);
    teams.forEach((t, i) => { let best = null, bw = -1; for (const [g, w] of gScore.get(t)) if (w > bw) { bw = w; best = g; } let gi = gIdx.get(best); if (gi === undefined) { gi = groups.length; gIdx.set(best, gi); groups.push(best); } TG[i] = gi; });
    const comps = [], cIdx = new Map(), H = new Int32Array(N), A = new Int32Array(N), C = new Int32Array(N), NEU = new Uint8Array(N), W = Float64Array.from(R.W);
    for (let k = 0; k < N; k++) { const m = R.M[k]; H[k] = teamIdx.get(m.h); A[k] = teamIdx.get(m.a); let c = cIdx.get(m.comp); if (c === undefined) { c = comps.length; cIdx.set(m.comp, c); comps.push(m.comp); } C[k] = c; NEU[k] = m.neutral ? 1 : 0; }
    const T = teams.length, NG = groups.length, NC = comps.length;
    const att = new Float64Array(T), def = new Float64Array(T), gat = new Float64Array(NG), gdf = new Float64Array(NG), mu = new Float64Array(NC), ha = new Float64Array(NC).fill(o.haPrior);
    { const s = new Float64Array(NC), n = new Float64Array(NC); for (let k = 0; k < N; k++) { s[C[k]] += W[k] * (YH[k] + YA[k]); n[C[k]] += 2 * W[k]; } for (let c = 0; c < NC; c++) mu[c] = Math.log(Math.max(0.05, s[c] / Math.max(1e-9, n[c]))) - o.haPrior / 2; }
    const ini = o.init;
    if (ini) {
      for (let i = 0; i < T; i++) { const j = ini.teamIdx.get(teams[i]); if (j !== undefined) { att[i] = ini.att[j]; def[i] = ini.def[j]; } }
      for (let g = 0; g < NG; g++) { const j = ini.gIdx.get(groups[g]); if (j !== undefined) { gat[g] = ini.gat[j]; gdf[g] = ini.gdf[j]; } }
      for (let c = 0; c < NC; c++) { const j = ini.cIdx.get(comps[c]); if (j !== undefined) { mu[c] = ini.mu[j]; ha[c] = ini.ha[j]; } }
    }
    const LH = new Float64Array(N), LA = new Float64Array(N), pT = 1 / (o.sdTeam * o.sdTeam), pL = 1 / (o.sdLeague * o.sdLeague), pH = 1 / (o.sdHome * o.sdHome);
    const gT = new Float64Array(T), hT = new Float64Array(T), gG = new Float64Array(NG), hG = new Float64Array(NG), gC = new Float64Array(NC), hC = new Float64Array(NC);
    const vAtt = new Float64Array(T), vDef = new Float64Array(T), vGat = new Float64Array(NG), vGdf = new Float64Array(NG), vMu = new Float64Array(NC), vHa = new Float64Array(NC);
    const eta = () => { for (let k = 0; k < N; k++) { const h = H[k], a = A[k], c = C[k], gh = TG[h], ga = TG[a]; LH[k] = Math.exp(mu[c] + (NEU[k] ? 0 : ha[c]) + gat[gh] + att[h] - gdf[ga] - def[a]); LA[k] = Math.exp(mu[c] + gat[ga] + att[a] - gdf[gh] - def[h]); } };
    let it = 0, passo = 1;
    const upd = (arr, g, h, prec, prior, i, v) => { const s = clamp((g[i] - prec * (arr[i] - prior)) / (h[i] + prec), -0.5, 0.5); arr[i] += s; v[i] = 1 / (h[i] + prec); if (Math.abs(s) > passo) passo = Math.abs(s); };
    for (; it < o.iters && passo > o.tol; it++) {
      passo = 0;
      eta(); gT.fill(0); hT.fill(0);
      for (let k = 0; k < N; k++) { const w = W[k]; gT[H[k]] += w * (YH[k] - LH[k]); hT[H[k]] += w * LH[k]; gT[A[k]] += w * (YA[k] - LA[k]); hT[A[k]] += w * LA[k]; }
      for (let i = 0; i < T; i++) upd(att, gT, hT, pT, 0, i, vAtt);
      eta(); gT.fill(0); hT.fill(0);
      for (let k = 0; k < N; k++) { const w = W[k]; gT[A[k]] -= w * (YH[k] - LH[k]); hT[A[k]] += w * LH[k]; gT[H[k]] -= w * (YA[k] - LA[k]); hT[H[k]] += w * LA[k]; }
      for (let i = 0; i < T; i++) upd(def, gT, hT, pT, 0, i, vDef);
      eta(); gG.fill(0); hG.fill(0);
      for (let k = 0; k < N; k++) { const w = W[k], gh = TG[H[k]], ga = TG[A[k]]; gG[gh] += w * (YH[k] - LH[k]); hG[gh] += w * LH[k]; gG[ga] += w * (YA[k] - LA[k]); hG[ga] += w * LA[k]; }
      for (let g = 0; g < NG; g++) upd(gat, gG, hG, pL, 0, g, vGat);
      eta(); gG.fill(0); hG.fill(0);
      for (let k = 0; k < N; k++) { const w = W[k], gh = TG[H[k]], ga = TG[A[k]]; gG[ga] -= w * (YH[k] - LH[k]); hG[ga] += w * LH[k]; gG[gh] -= w * (YA[k] - LA[k]); hG[gh] += w * LA[k]; }
      for (let g = 0; g < NG; g++) upd(gdf, gG, hG, pL, 0, g, vGdf);
      eta(); gC.fill(0); hC.fill(0);
      for (let k = 0; k < N; k++) { const w = W[k], c = C[k]; gC[c] += w * (YH[k] - LH[k] + YA[k] - LA[k]); hC[c] += w * (LH[k] + LA[k]); }
      for (let c = 0; c < NC; c++) upd(mu, gC, hC, 1e-4, 0, c, vMu);
      eta(); gC.fill(0); hC.fill(0);
      for (let k = 0; k < N; k++) if (!NEU[k]) { const w = W[k], c = C[k]; gC[c] += w * (YH[k] - LH[k]); hC[c] += w * LH[k]; }
      for (let c = 0; c < NC; c++) upd(ha, gC, hC, pH, o.haPrior, c, vHa);
      // Movimentos exatos que não alteram nenhum λ: dividem o nível entre clube e liga como as distribuições a priori mandam.
      const SA = new Float64Array(NG), SD = new Float64Array(NG), NGt = new Float64Array(NG);
      for (let i = 0; i < T; i++) { SA[TG[i]] += att[i]; SD[TG[i]] += def[i]; NGt[TG[i]]++; }
      for (let g = 0; g < NG; g++) { const den = pL + NGt[g] * pT, kA = (SA[g] * pT - gat[g] * pL) / den, kD = (SD[g] * pT - gdf[g] * pL) / den; gat[g] += kA; gdf[g] += kD; SA[g] = kA; SD[g] = kD; }
      for (let i = 0; i < T; i++) { att[i] -= SA[TG[i]]; def[i] -= SD[TG[i]]; }
      let mA = 0, mD = 0; for (let g = 0; g < NG; g++) { mA += gat[g]; mD += gdf[g]; } mA /= NG; mD /= NG;
      for (let g = 0; g < NG; g++) { gat[g] -= mA; gdf[g] -= mD; } for (let c = 0; c < NC; c++) mu[c] += mA - mD;
    }
    eta();
    const nT = new Float64Array(T), wT = new Float64Array(T), ultimo = new Float64Array(T), nomes = new Array(T);
    for (let k = 0; k < N; k++) { const m = R.M[k], t = Date.parse(m.date); for (const [i, nm] of [[H[k], m.hn], [A[k], m.an]]) { nT[i]++; wT[i] += W[k]; if (t > ultimo[i]) { ultimo[i] = t; nomes[i] = nm; } } }
    return { o, cutoff: o.cutoff, N, iters: it, convergiu: passo <= o.tol, teams, teamIdx, TG, groups, gIdx, comps, cIdx, att, def, gat, gdf, mu, ha, vAtt, vDef, vGat, vGdf, vMu, vHa, pT, pL, nT, wT, ultimo, nomes, LH, LA, W };
  }

  function tau(x, y, l, m, r) { if (x === 0 && y === 0) return 1 - l * m * r; if (x === 0 && y === 1) return 1 + l * r; if (x === 1 && y === 0) return 1 + m * r; if (x === 1 && y === 1) return 1 - r; return 1; }

  /* Gols: ajuste + ρ de Dixon-Coles + fração de gols no 1º tempo por competição. */
  function ajustarGols(jogos, opt = {}) {
    const o = Object.assign({}, PADRAO, opt, { cutoff: opt.cutoff ?? Date.now() });
    const R = selecionar(jogos, o, m => (m.hg == null || m.ag == null) ? null : [m.hg, m.ag, m.hst, m.ast, m.ilh ?? null, m.ila ?? null]);
    let g = 0, s = 0; for (const y of R.Y) if (y[2] != null && y[3] != null) { g += y[0] + y[1]; s += y[2] + y[3]; }
    const kappa = s > 0 ? g / s : 0, b = o.sotBlend;
    const YH = Float64Array.from(R.Y, y => (b > 0 && y[2] != null && y[3] != null) ? (1 - b) * y[0] + b * kappa * y[2] : y[0]);
    const YA = Float64Array.from(R.Y, y => (b > 0 && y[2] != null && y[3] != null) ? (1 - b) * y[1] + b * kappa * y[3] : y[1]);
    // Gols esperados implícitos no fechamento do mercado (jogos passados): menos ruído que placar e chutes.
    const w = o.mktBlend || 0; if (w > 0) for (let k = 0; k < R.Y.length; k++) { const y = R.Y[k]; if (y[4] != null && y[5] != null) { YH[k] = (1 - w) * YH[k] + w * y[4]; YA[k] = (1 - w) * YA[k] + w * y[5]; } }
    const F = nucleo(R, YH, YA, o);
    let rho = 0, best = -Infinity;
    for (let r = -0.2; r <= 0.1001; r += 0.01) { let ll = 0, ok = true; for (let k = 0; k < F.N; k++) { const y = R.Y[k]; if (y[0] > 1 || y[1] > 1) continue; const t = tau(y[0], y[1], F.LH[k], F.LA[k], r); if (!(t > 0)) { ok = false; break; } ll += F.W[k] * Math.log(t); } if (ok && ll > best) { best = ll; rho = Math.round(r * 100) / 100; } }
    // Fração do 1º tempo: média por competição, encolhida para a média geral (peso de 300 gols).
    const fr = new Map(); let tg = 0, t1 = 0;
    for (const m of R.M) if (m.h1 != null && m.hg != null) { const tot = m.hg + m.ag, p = m.h1 + m.a1; let e = fr.get(m.comp); if (!e) fr.set(m.comp, e = [0, 0]); e[0] += tot; e[1] += p; tg += tot; t1 += p; }
    const geral = tg ? t1 / tg : 0.445, fracao1T = {}; for (const [c, [a, p]] of fr) fracao1T[c] = (p + 300 * geral) / (a + 300);
    delete F.LH; delete F.LA; delete F.W;
    return Object.assign(F, { tipo: 'gols', rho, kappa, fracao1T, fracao1TGeral: geral });
  }

  /* Escanteios ou cartões (amarelos + vermelhos). Dispersão estimada nos jogos dos últimos 365 dias. */
  function ajustarContagem(jogos, tipo, opt = {}) {
    const o = Object.assign({}, PADRAO_CONTAGEM, opt, { cutoff: opt.cutoff ?? Date.now() });
    const alvo = tipo === 'escanteios' ? (m => m.hc != null && m.ac != null ? [m.hc, m.ac] : null) : (m => m.hy != null && m.ay != null ? [m.hy + (m.hr || 0), m.ay + (m.ar || 0)] : null);
    const R = selecionar(jogos, o, alvo), F = nucleo(R, Float64Array.from(R.Y, y => y[0]), Float64Array.from(R.Y, y => y[1]), o);
    let num = 0, den = 0; const limite = o.cutoff - 365 * 864e5;
    for (let k = 0; k < F.N; k++) { if (Date.parse(R.M[k].date) < limite) continue; const mu = F.LH[k] + F.LA[k], y = R.Y[k][0] + R.Y[k][1]; num += (y - mu) ** 2 - mu; den += mu * mu; }
    const phi = num > 0 ? clamp(den / num, 2, 500) : 500;
    delete F.LH; delete F.LA; delete F.W;
    return Object.assign(F, { tipo, phi });
  }

  function paramTime(F, id, comp) {
    const i = F.teamIdx.get(id);
    if (i !== undefined) return { att: F.att[i], def: F.def[i], va: F.vAtt[i], vd: F.vDef[i], g: F.TG[i], conhecido: true, n: F.nT[i], w: F.wT[i] };
    const g = F.gIdx.get(grupoDe(comp));
    return { att: 0, def: 0, va: 1 / F.pT, vd: 1 / F.pT, g: g === undefined ? -1 : g, conhecido: false, n: 0, w: 0 };
  }
  function paramComp(F, comp) {
    const c = F.cIdx.get(comp); if (c !== undefined) return { mu: F.mu[c], ha: F.ha[c], vmu: F.vMu[c], vha: F.vHa[c] };
    const tipo = (COMP()[comp] || {}).tipo, xs = F.comps.map((id, i) => [id, i]).filter(([id]) => (COMP()[id] || {}).tipo === tipo), arr = xs.length ? xs : F.comps.map((id, i) => [id, i]);
    return { mu: arr.reduce((s, [, i]) => s + F.mu[i], 0) / arr.length, ha: F.o.haPrior, vmu: 0.01, vha: F.o.sdHome ** 2 };
  }
  /* Previsão de λ (média e variância no log). Para gols, aplica a correção de confiança validada. */
  function prever(F, m) {
    const c = paramComp(F, m.comp), th = paramTime(F, m.h, m.comp), ta = paramTime(F, m.a, m.comp);
    const ga = g => g >= 0 ? F.gat[g] : 0, gd = g => g >= 0 ? F.gdf[g] : 0, vg = (v, g) => g >= 0 ? v[g] : 1 / F.pL;
    let eh = c.mu + (m.neutral ? 0 : c.ha) + ga(th.g) + th.att - gd(ta.g) - ta.def, ea = c.mu + ga(ta.g) + ta.att - gd(th.g) - th.def;
    let vh = th.va + ta.vd + vg(F.vGat, th.g) + vg(F.vGdf, ta.g) + c.vmu + (m.neutral ? 0 : c.vha), va = ta.va + th.vd + vg(F.vGat, ta.g) + vg(F.vGdf, th.g) + c.vmu;
    const s = F.o.esticar || 1;
    if (s !== 1) { const m0 = (eh + ea) / 2; eh = m0 + s * (eh - m0); ea = m0 + s * (ea - m0); vh *= s * s; va *= s * s; }
    return { eh, ea, vh, va, lh: Math.exp(eh), la: Math.exp(ea), casa: th, fora: ta };
  }

  /* Força para exibição: nível total (ataque + defesa, já com o nível da liga) e posição entre clubes ativos. */
  function tabelaForca(F, { minJogos = 12, diasAtivo = 200 } = {}) {
    const lim = F.cutoff - diasAtivo * 864e5, out = [];
    for (let i = 0; i < F.teams.length; i++) { if (F.nT[i] < minJogos || F.ultimo[i] < lim) continue; const g = F.TG[i]; out.push({ id: F.teams[i], nome: F.nomes[i], grupo: F.groups[g], ataque: F.att[i] + F.gat[g], defesa: F.def[i] + F.gdf[g], jogos: F.nT[i] }); }
    out.forEach(x => { x.nota = x.ataque + x.defesa; }); out.sort((a, b) => b.nota - a.nota); out.forEach((x, i) => { x.posicao = i + 1; });
    return { lista: out, porId: new Map(out.map(x => [x.id, x])) };
  }

  /* ---------- Placar e mercados ---------- */
  function pois(l, max) { const p = new Float64Array(max + 1); p[0] = Math.exp(-l); for (let k = 1; k <= max; k++) p[k] = p[k - 1] * l / k; return p; }
  function matriz(lh, la, rho = 0, max = 12) {
    const ph = pois(lh, max), pa = pois(la, max), M = []; let s = 0;
    for (let i = 0; i <= max; i++) { const row = new Float64Array(max + 1); for (let j = 0; j <= max; j++) { let v = ph[i] * pa[j]; if (i < 2 && j < 2) v *= Math.max(0, tau(i, j, lh, la, rho)); row[j] = v; s += v; } M.push(row); }
    for (const row of M) for (let j = 0; j < row.length; j++) row[j] /= s;
    return M;
  }
  // Mercados de gols decididos pelo placar de 90 min. l = linha (handicap do próprio time no 'ah').
  function vence(mk, i, j) {
    const { t, s, l } = mk;
    if (t === '1x2') return s === 'h' ? i > j : s === 'a' ? j > i : i === j;
    if (t === 'dc') return s === '1x' ? i >= j : s === 'x2' ? j >= i : i !== j;
    if (t === 'btts') return s === 's' ? i > 0 && j > 0 : i === 0 || j === 0;
    if (t === 'tot') return s === 'o' ? i + j > l : i + j < l;
    if (t === 'tm') return s === 'ho' ? i > l : s === 'hu' ? i < l : s === 'ao' ? j > l : j < l;
    if (t === 'ah') return (s === 'h' ? i - j : j - i) + l > 0;
    if (t === 'cs') return i === l[0] && j === l[1];
    return false;
  }
  const doPlacar = mk => ['1x2', 'dc', 'btts', 'tot', 'tm', 'ah', 'cs'].includes(mk.t);
  function prob(M, mk) { let p = 0; for (let i = 0; i < M.length; i++) for (let j = 0; j < M.length; j++) if (vence(mk, i, j)) p += M[i][j]; return p; }
  function probConjunta(M, mks) { let p = 0; for (let i = 0; i < M.length; i++) for (let j = 0; j < M.length; j++) if (mks.every(mk => vence(mk, i, j))) p += M[i][j]; return p; }
  const LINHAS = Object.freeze({ tot: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5], tm: [0.5, 1.5, 2.5], ah: [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5], t1: [0.5, 1.5, 2.5], esc: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5], escT: [3.5, 4.5, 5.5], car: [2.5, 3.5, 4.5, 5.5, 6.5], carT: [0.5, 1.5, 2.5] });
  function especificacoesGols() {
    const out = [{ t: '1x2', s: 'h' }, { t: '1x2', s: 'd' }, { t: '1x2', s: 'a' }, { t: 'dc', s: '1x' }, { t: 'dc', s: 'x2' }, { t: 'dc', s: '12' }, { t: 'btts', s: 's' }, { t: 'btts', s: 'n' }];
    for (const l of LINHAS.tot) out.push({ t: 'tot', s: 'o', l }, { t: 'tot', s: 'u', l });
    for (const l of LINHAS.tm) out.push({ t: 'tm', s: 'ho', l }, { t: 'tm', s: 'hu', l }, { t: 'tm', s: 'ao', l }, { t: 'tm', s: 'au', l });
    for (const l of LINHAS.ah) out.push({ t: 'ah', s: 'h', l }, { t: 'ah', s: 'a', l });
    return out;
  }
  // Gols no 1º tempo: Poisson com λ × fração do 1º tempo da competição.
  function prob1T(lh, la, frac, mk) { const L = (lh + la) * frac; let cdf = 0, pk = Math.exp(-L); for (let k = 0; k <= Math.floor(mk.l); k++) { if (k) pk *= L / k; cdf += pk; } return mk.s === 'o' ? 1 - cdf : cdf; }
  // 2º tempo: a mesma conta com a fração restante dos gols.
  function prob2T(lh, la, frac, mk) { return prob1T(lh, la, 1 - frac, mk); }
  // Tempo com mais gols: gols de cada tempo como Poisson independentes.
  function tempoMaisGols(lh, la, frac) {
    const p1 = pois((lh + la) * frac, 15), p2 = pois((lh + la) * (1 - frac), 15); let a = 0, b = 0, e = 0;
    for (let i = 0; i <= 15; i++) for (let j = 0; j <= 15; j++) { const v = p1[i] * p2[j]; if (i > j) a += v; else if (i < j) b += v; else e += v; }
    const s = a + b + e; return { '1': a / s, '2': b / s, x: e / s };
  }
  // Quem marca primeiro (gols como processo de Poisson): mandante λh/L·(1−e^−L), visitante λa/L·(1−e^−L), sem gols e^−L.
  function primeiroGol(lh, la) { const L = lh + la, q = Math.exp(-L); return { h: lh / L * (1 - q), a: la / L * (1 - q), '-': q }; }

  /* Chance de um jogador marcar (se começar jogando). Taxa de gols por jogo como titular a partir de gols e chutes no alvo
   * (temporada atual + metade da anterior), puxada para uma âncora da posição até o jogador ter jogos suficientes (k = 5):
   * evita que 1 gol em 2 jogos vire 50% de chance. As taxas são normalizadas para somar os gols esperados do time no jogo. */
  const ANCORA_POSICAO = { F: 0.30, M: 0.10, D: 0.035 }, K_ANCORA = 5;
  function artilheiros(elenco, lambdaTime, { max = 4 } = {}) {
    if (!elenco || !Number.isFinite(lambdaTime)) return [];
    const junta = new Map();
    for (const [lista, peso] of [[elenco.atual || [], 1], [elenco.anterior || [], 0.5]]) for (const p of lista) {
      if (p.pos === 'G') continue;
      const x = junta.get(p.id) || { id: p.id, nome: p.nome, pos: p.pos, jogos: 0, banco: 0, gols: 0, noAlvo: 0, lesionado: false, noElenco: false };
      x.jogos += peso * p.jogos; x.banco += peso * p.banco; x.gols += peso * p.gols; x.noAlvo += peso * p.noAlvo;
      if (peso === 1) { x.lesionado = p.lesionado; x.noElenco = true; x.nome = p.nome; x.pos = p.pos; x.golsAtual = p.gols; x.jogosAtual = p.jogos; }
      junta.set(p.id, x);
    }
    const js = [...junta.values()], G = js.reduce((s, p) => s + p.gols, 0), S = js.reduce((s, p) => s + p.noAlvo, 0);
    const maxJ = l => l && l.length ? Math.max(...l.map(p => p.jogos)) : 0, jogosTime = maxJ(elenco.atual) + 0.5 * maxJ(elenco.anterior);
    if (!jogosTime) return [];
    const kappa = G > 0 && S > 0 ? G / S : 0.3;
    for (const p of js) { p.titular = Math.max(0, p.jogos - p.banco) + 0.35 * p.banco; const obs = 0.5 * p.gols + 0.5 * kappa * p.noAlvo, a = ANCORA_POSICAO[p.pos] ?? 0.08; p.taxa = (obs + a * K_ANCORA) / (p.titular + K_ANCORA); }
    const T = js.reduce((s, p) => s + p.taxa * Math.min(1, p.titular / jogosTime), 0); if (!(T > 0)) return [];
    return js.filter(p => p.noElenco && !p.lesionado && p.jogos - p.banco >= 2).map(p => {
      const lambda = p.taxa * lambdaTime / T;
      return { nome: p.nome, pos: p.pos, p: 1 - Math.exp(-lambda), gols: p.golsAtual || 0, jogos: p.jogosAtual || 0 };
    }).sort((a, b) => b.p - a.p).slice(0, max);
  }

  // Binomial negativa para contagens (média mu, dispersão phi).
  function nbAte(mu, phi, k) { const r = phi, q = mu / (r + mu); let pk = Math.pow(r / (r + mu), r), cdf = pk; for (let i = 1; i <= k; i++) { pk *= (i - 1 + r) / i * q; cdf += pk; } return clamp(cdf, 0, 1); }
  function probContagem(mu, phi, s, l) { const ate = nbAte(mu, phi, Math.floor(l)); return s === 'o' ? 1 - ate : ate; }

  /* Gols esperados implícitos no mercado: λ que reproduzem o 1X2 sem margem (e a linha principal de gols, se houver). */
  function implicitos(q, tot, rho = -0.03) {
    const perda = (lh, la) => { const M = matriz(lh, la, rho, 10); let h = 0, d = 0, a = 0, ov = 0; for (let i = 0; i < M.length; i++) for (let j = 0; j < M.length; j++) { const v = M[i][j]; if (i > j) h += v; else if (i < j) a += v; else d += v; if (tot && i + j > tot.linha) ov += v; } let e = 0; if (q) e += (h - q[0]) ** 2 + (d - q[1]) ** 2 + (a - q[2]) ** 2; if (tot) e += (ov - tot.pOver) ** 2; return e; };
    let bT = 2.6, bS = 0.55, best = Infinity;
    for (let T = 0.6; T <= 6.01; T += 0.15) for (let s = 0.03; s <= 0.971; s += 0.02) { const v = perda(T * s, T * (1 - s)); if (v < best) { best = v; bT = T; bS = s; } }
    let dT = 0.15, dS = 0.02;
    for (let r = 0; r < 3; r++) { dT /= 4; dS /= 4; const cT = bT, cS = bS; for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const T = cT + i * dT, s = cS + j * dS; if (T <= 0.2 || s <= 0.005 || s >= 0.995) continue; const v = perda(T * s, T * (1 - s)); if (v < best) { best = v; bT = T; bS = s; } } }
    return { lh: bT * bS, la: bT * (1 - bS), erro: Math.sqrt(best / ((q ? 3 : 0) + (tot ? 1 : 0) || 1)) };
  }

  /* Faixa de 5% a 95% das probabilidades do modelo, sorteando λ pela incerteza dos parâmetros. */
  function faixas(pred, rho, specs, n = 160, seed = 7) {
    let st = seed >>> 0 || 1; const rnd = () => { st ^= st << 13; st ^= st >>> 17; st ^= st << 5; return ((st >>> 0) + 0.5) / 4294967296; };
    const normal = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd()), amostras = specs.map(() => []);
    for (let k = 0; k < n; k++) { const M = matriz(Math.exp(pred.eh + Math.sqrt(pred.vh) * normal()), Math.exp(pred.ea + Math.sqrt(pred.va) * normal()), rho, 10); specs.forEach((mk, i) => amostras[i].push(prob(M, mk))); }
    const q = (xs, p) => { const s = xs.slice().sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
    return amostras.map(xs => [q(xs, 0.05), q(xs, 0.95)]);
  }

  G.PCModelo = Object.freeze({ PADRAO, PADRAO_CONTAGEM, LINHAS, grupoDe, ajustarGols, ajustarContagem, prever, paramTime, paramComp, tabelaForca, tau, matriz, vence, doPlacar, prob, probConjunta,
    especificacoesGols, prob1T, prob2T, tempoMaisGols, primeiroGol, artilheiros, probContagem, implicitos, faixas });
})(typeof globalThis !== 'undefined' ? globalThis : window);
