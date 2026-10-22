// Revisão das previsões e bilhetes que o robô registrou antes dos jogos, contra o que aconteceu.
import fs from 'node:fs'; import path from 'node:path';
import { lerJSON } from './hub.mjs';

export function deChave(chave) {
  const [t, s, l] = chave.split(':'), mk = { t, s };
  if (l !== undefined) mk.l = t === 'cs' ? l.split('-').map(Number) : Number(l);
  return mk;
}
const L = p => Math.log(Math.min(1 - 1e-9, Math.max(1e-9, p)));
const r4 = v => Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;

export function revisar({ K, D, jogos, dados, dias = 45 }) {
  const dir = path.join(dados, 'previsoes'); if (!fs.existsSync(dir)) return { geradoEm: new Date().toISOString(), jogos: 0 };
  const arquivos = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const cacheOdds = new Map(), fechamento = (comp, inicio, id) => { const k = comp + '-' + new Date(inicio).getUTCFullYear(); if (!cacheOdds.has(k)) cacheOdds.set(k, lerJSON(path.join(dados, 'odds', k + '.json'), {})); const o = cacheOdds.get(k)[id]; return o && o.f && o.f[0] && o.f[1] && o.f[2] ? o.f : null; };
  const fam = {}, leitura = { n: 0, acertos: 0, esperado: 0 }, niveis = {}, mov = { n: 0, aFavor: 0, soma: 0 }, porDia = [];
  const somaFam = (f, p, q, y) => { const x = fam[f] || (fam[f] = { n: 0, llModelo: 0, llMercado: 0, nMercado: 0, llModeloComMercado: 0, brier: 0, previsto: 0, aconteceu: 0 }); x.n++; x.llModelo -= y ? L(p) : L(1 - p); x.brier += (p - y) ** 2; x.previsto += p; x.aconteceu += y; if (Number.isFinite(q)) { x.nMercado++; x.llMercado -= y ? L(q) : L(1 - q); x.llModeloComMercado -= y ? L(p) : L(1 - p); } };
  let nJogos = 0;
  for (const f of arquivos) {
    const dia = f.slice(0, 10), arq = lerJSON(path.join(dir, f), { jogos: {}, sugestoes: {} }), det = { dia, jogos: [], sugestoes: [] };
    for (const [id, p] of Object.entries(arq.jogos || {})) {
      const j = jogos.get(id); if (!j || !j.done || j.hg == null) { det.jogos.push({ id, jogo: p.casa + ' × ' + p.fora, comp: p.comp, inicio: p.inicio, pendente: true }); continue; }
      nJogos++;
      for (const [chave, [pm, pk]] of Object.entries(p.linhas)) { const mk = deChave(chave), y = D.liquidar(mk, j); if (y === null || !Number.isFinite(pm)) continue; somaFam(K.familia(mk), pm, pk, y); }
      const ditas = (p.leitura || []).map(chave => { const mk = deChave(chave), y = D.liquidar(mk, j), pm = p.linhas[chave] ? p.linhas[chave][0] : null; if (y !== null) { leitura.n++; leitura.acertos += y; leitura.esperado += pm; } return { rotulo: K.rotulo(mk, p.casa, p.fora), p: pm, odd: p.linhas[chave] ? p.linhas[chave][2] : null, ok: y }; });
      const x12 = ['h', 'd', 'a'].map(s => ({ s, l: p.linhas['1x2:' + s] })).filter(x => x.l), fav = x12.length === 3 ? x12.reduce((b, x) => x.l[0] > b.l[0] ? x : b) : null;
      const f12 = fechamento(p.comp, p.inicio, id);
      if (f12 && x12.length === 3 && x12.every(x => Number.isFinite(x.l[1]))) {
        const inv = f12.slice(0, 3).map(o => 1 / o), s = inv[0] + inv[1] + inv[2], qf = inv.map(v => v / s);
        x12.forEach((x, i) => { const dif = x.l[0] - x.l[1]; if (Math.abs(dif) < 0.03) return; const andou = qf[i] - x.l[1]; mov.n++; mov.soma += Math.sign(dif) * andou; if (Math.sign(andou) === Math.sign(dif)) mov.aFavor++; });
      }
      det.jogos.push({ id, jogo: p.casa + ' × ' + p.fora, comp: p.comp, inicio: p.inicio, placar: [j.hg, j.ag], favorito: fav ? { rotulo: K.rotulo({ t: '1x2', s: fav.s }, p.casa, p.fora), p: fav.l[0], pMercado: fav.l[1], ok: D.liquidar({ t: '1x2', s: fav.s }, j) } : null, leitura: ditas, filtro: p.filtro });
    }
    for (const [nivel, s] of Object.entries(arq.sugestoes || {})) {
      if (!s || !s.pernas) { det.sugestoes.push({ nivel, indisponivel: s ? s.indisponivel : 'sem dados' }); continue; }
      const res = s.pernas.map(pp => { const j = jogos.get(pp.id); return j && j.done && j.hg != null ? D.liquidar(deChave(pp.chave), j) : null; });
      const perdeu = res.some(y => y === 0), ganhou = res.every(y => y === 1), status = perdeu ? 'perdeu' : ganhou ? 'ganhou' : 'pendente';
      const x = niveis[nivel] || (niveis[nivel] = { bilhetes: 0, ganhos: 0, pendentes: 0, lucro: 0, somaOdd: 0, somaChance: 0, somaChanceMercado: 0, nMercado: 0 });
      if (status === 'pendente') x.pendentes++; else { x.bilhetes++; x.somaOdd += s.odd; x.somaChance += s.pModelo; if (Number.isFinite(s.pMercado)) { x.somaChanceMercado += s.pMercado; x.nMercado++; } if (ganhou) { x.ganhos++; x.lucro += s.odd - 1; } else x.lucro -= 1; }
      det.sugestoes.push({ nivel, odd: s.odd, pModelo: s.pModelo, pMercado: s.pMercado, status, pernas: s.pernas.map((pp, i) => ({ rotulo: pp.rotulo, jogo: pp.jogo, odd: pp.odd, ok: res[i] })) });
    }
    porDia.push(det);
  }
  for (const x of Object.values(fam)) { const n = x.n; x.llModelo = r4(x.llModelo / n); x.brier = r4(x.brier / n); x.previsto = r4(x.previsto / n); x.aconteceu = r4(x.aconteceu / n); x.llMercado = x.nMercado ? r4(x.llMercado / x.nMercado) : null; x.llModeloComMercado = x.nMercado ? r4(x.llModeloComMercado / x.nMercado) : null; }
  for (const x of Object.values(niveis)) { x.retorno = x.bilhetes ? r4(x.lucro / x.bilhetes) : null; x.oddMedia = x.bilhetes ? r4(x.somaOdd / x.bilhetes) : null; x.chanceMedia = x.bilhetes ? r4(x.somaChance / x.bilhetes) : null; x.chanceMercadoMedia = x.nMercado ? r4(x.somaChanceMercado / x.nMercado) : null; x.lucro = r4(x.lucro); delete x.somaOdd; delete x.somaChance; delete x.somaChanceMercado; }
  return { geradoEm: new Date().toISOString(), jogos: nJogos, porFamilia: fam, leitura: { n: leitura.n, acertos: leitura.acertos, esperado: r4(leitura.esperado) },
    niveis, movimentoDoMercado: { n: mov.n, aFavorDoModelo: mov.aFavor, medio: mov.n ? r4(mov.soma / mov.n) : null },
    dias: porDia.slice(-dias).reverse() };
}
