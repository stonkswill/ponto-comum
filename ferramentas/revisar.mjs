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
  const fam = {}, leitura = { n: 0, acertos: 0, esperado: 0 }, mov = { n: 0, aFavor: 0, soma: 0 }, porDia = [];
  const pal = {}; const somaPal = (tipo, chance, odd, y, melhor) => { const x = pal[tipo] || (pal[tipo] = { n: 0, acertos: 0, previsto: 0, comOdd: 0, somaOdd: 0, lucro: 0, lucroMelhor: 0 }); x.n++; x.acertos += y; x.previsto += chance; if (odd > 1) { const mo = melhor > 1 ? melhor : odd; x.comOdd++; x.somaOdd += odd; x.lucro += y ? odd - 1 : -1; x.lucroMelhor += y ? mo - 1 : -1; } };
  const jog = { n: 0, marcaram: 0, previsto: 0, llModelo: 0, comOdd: 0, marcaramComOdd: 0, previstoComOdd: 0, implicitoBruto: 0, apostas: 0, lucro: 0, faixas: Array.from({ length: 6 }, () => [0, 0, 0]) };
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
      if (p.jogadores && j.gm) for (const lado of ['casa', 'fora']) {
        const marcadores = j.gm.filter(g => g[0] === (lado === 'casa' ? 'h' : 'a') && !g[2]).map(g => ({ nome: g[1] }));
        for (const [nome, pj, odd] of p.jogadores[lado] || []) {
          if (!Number.isFinite(pj)) continue; const y = K.acharJogador(marcadores, nome) ? 1 : 0;
          jog.n++; jog.marcaram += y; jog.previsto += pj; jog.llModelo -= y ? L(pj) : L(1 - pj); const fx = jog.faixas[Math.min(5, Math.floor(pj * 10))]; fx[0]++; fx[1] += pj; fx[2] += y;
          if (odd > 1) { jog.comOdd++; jog.marcaramComOdd += y; jog.previstoComOdd += pj; jog.implicitoBruto += 1 / odd; if (pj * odd > 1.1) { jog.apostas++; jog.lucro += y ? odd - 1 : -1; } }
        }
      }
      const palDia = [];
      if (p.palpites) {
        for (const tipo of ['valor', 'principal', 'oddMaior', 'destaque']) { const x = p.palpites[tipo]; if (!x) continue; const y = D.liquidar(deChave(x.chave), j); if (y === null) continue; somaPal(tipo, x.chance, x.odd, y, x.melhorOdd); palDia.push({ tipo, rotulo: x.rotulo, odd: x.melhorOdd || x.odd, casa: x.casaMelhor || null, chance: x.chance, ok: y }); }
        const xj = p.palpites.jogador; if (xj && j.gm) { const y = K.acharJogador(j.gm.filter(g => g[0] === xj.lado && !g[2]).map(g => ({ nome: g[1] })), xj.nome) ? 1 : 0; somaPal('jogador', xj.p, xj.odd, y); palDia.push({ tipo: 'jogador', rotulo: xj.nome + ' marca', odd: xj.odd, chance: xj.p, ok: y }); }
      }
      det.jogos.push({ id, jogo: p.casa + ' × ' + p.fora, comp: p.comp, inicio: p.inicio, placar: [j.hg, j.ag], palpites: palDia, nada: !!(p.palpites && p.palpites.nada), favorito: fav ? { rotulo: K.rotulo({ t: '1x2', s: fav.s }, p.casa, p.fora), p: fav.l[0], pMercado: fav.l[1], ok: D.liquidar({ t: '1x2', s: fav.s }, j) } : null, leitura: ditas, filtro: p.filtro });
    }
    porDia.push(det);
  }
  for (const x of Object.values(fam)) { const n = x.n; x.llModelo = r4(x.llModelo / n); x.brier = r4(x.brier / n); x.previsto = r4(x.previsto / n); x.aconteceu = r4(x.aconteceu / n); x.llMercado = x.nMercado ? r4(x.llMercado / x.nMercado) : null; x.llModeloComMercado = x.nMercado ? r4(x.llModeloComMercado / x.nMercado) : null; }
  for (const x of Object.values(pal)) { x.previsto = r4(x.previsto / x.n); x.oddMedia = x.comOdd ? r4(x.somaOdd / x.comOdd) : null; x.retorno = x.comOdd ? r4(x.lucro / x.comOdd) : null; x.retornoMelhorOdd = x.comOdd ? r4(x.lucroMelhor / x.comOdd) : null; x.lucro = r4(x.lucro); delete x.lucroMelhor; delete x.somaOdd; }
  return { geradoEm: new Date().toISOString(), jogos: nJogos, porFamilia: fam, leitura: { n: leitura.n, acertos: leitura.acertos, esperado: r4(leitura.esperado) },
    jogadores: jog.n ? { n: jog.n, marcaram: jog.marcaram, previsto: r4(jog.previsto), llModelo: r4(jog.llModelo / jog.n), comOdd: jog.comOdd, marcaramComOdd: jog.marcaramComOdd, previstoModeloComOdd: r4(jog.previstoComOdd), implicitoBrutoComOdd: r4(jog.implicitoBruto),
      apostasModeloAcimaDaOdd: { n: jog.apostas, retorno: jog.apostas ? r4(jog.lucro / jog.apostas) : null }, faixas: jog.faixas.map((f, i) => f[0] ? { de: i / 10, n: f[0], previsto: r4(f[1] / f[0]), aconteceu: r4(f[2] / f[0]) } : null).filter(Boolean) } : null,
    palpites: pal, movimentoDoMercado: { n: mov.n, aFavorDoModelo: mov.aFavor, medio: mov.n ? r4(mov.soma / mov.n) : null },
    dias: porDia.slice(-dias).reverse() };
}
