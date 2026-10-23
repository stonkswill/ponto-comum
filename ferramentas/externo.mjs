// Fontes externas para backtest e modelo (roda no GitHub Actions).
// 1. football-data.co.uk: resultados, chutes, escanteios, cartões e odds de várias casas (Bet365, Pinnacle, média, melhor odd),
//    de abertura e de fechamento, por liga e temporada → dados/externo/fd/{LIGA}-{TEMPORADA}.csv
// 2. Understat: gols esperados (xG) por jogo nas 5 grandes ligas → dados/externo/understat/{liga}-{ano}.json
import fs from 'node:fs'; import path from 'node:path';
import { RAIZ } from './hub.mjs';
const DIR = path.join(process.env.DADOS_DIR || path.join(RAIZ, 'dados'), 'externo');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const espera = ms => new Promise(r => setTimeout(r, ms));
async function baixar(url, { tentativas = 3, headers = {} } = {}) {
  for (let i = 0; i < tentativas; i++) {
    try { const r = await fetch(url, { headers: Object.assign({ 'user-agent': 'Mozilla/5.0 (ponto-comum; pesquisa pessoal)' }, headers) }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
    catch (e) { if (i === tentativas - 1) { log('falhou', url, e.message); return null; } await espera(2000 * (i + 1)); }
  }
}
const gravar = (f, txt) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const antes = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; if (antes !== txt) { fs.writeFileSync(f, txt); return true; } return false; };

// ---------- football-data.co.uk ----------
const LIGAS_FD = ['E0', 'E1', 'SP1', 'D1', 'I1', 'F1', 'N1', 'P1'];
const ano = new Date().getUTCFullYear(), mes = new Date().getUTCMonth() + 1, ultimaTemporada = mes >= 7 ? ano : ano - 1; // temporada que começou em jul/ago
const temporadas = []; for (let y = 2018; y <= ultimaTemporada; y++) temporadas.push(String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0'));
let nFd = 0;
for (const t of temporadas) for (const liga of LIGAS_FD) {
  const f = path.join(DIR, 'fd', liga + '-' + t + '.csv'), atual = t === temporadas[temporadas.length - 1] || t === temporadas[temporadas.length - 2];
  if (fs.existsSync(f) && !atual && !process.env.FORCAR) continue; // temporadas fechadas não mudam
  const txt = await baixar('https://www.football-data.co.uk/mmz4281/' + t + '/' + liga + '.csv'); await espera(400);
  if (txt && txt.includes('HomeTeam')) { if (gravar(f, txt.replace(/\r/g, ''))) nFd++; }
}
log('football-data:', nFd, 'arquivos novos ou atualizados');

// ---------- Understat ----------
const LIGAS_US = ['EPL', 'La_liga', 'Bundesliga', 'Serie_A', 'Ligue_1'];
const decodificar = s => s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
async function jogosUnderstat(liga, y) {
  // Formato antigo: JSON embutido na página. Formato novo: endpoint getLeagueData.
  const html = await baixar('https://understat.com/league/' + liga + '/' + y);
  const m = html && /datesData\s*=\s*JSON\.parse\('([^']+)'\)/.exec(html);
  if (m) return JSON.parse(decodificar(m[1]));
  const j = await baixar('https://understat.com/getLeagueData/' + liga + '/' + y, { headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://understat.com/league/' + liga + '/' + y } });
  if (!j) return null; try { const d = JSON.parse(j); return d.dates || d.datesData || null; } catch { return null; }
}
let nUs = 0;
for (let y = 2018; y <= ultimaTemporada; y++) for (const liga of LIGAS_US) {
  const f = path.join(DIR, 'understat', liga + '-' + y + '.json'), atual = y >= ultimaTemporada - 1;
  if (fs.existsSync(f) && !atual && !process.env.FORCAR) continue;
  const lista = await jogosUnderstat(liga, y); await espera(800);
  if (!Array.isArray(lista)) { log('understat sem dados', liga, y); continue; }
  const comp = lista.filter(x => x.isResult || (x.goals && x.goals.h != null)).map(x => [String(x.id), x.datetime, x.h.title, x.a.title, Number(x.goals.h), Number(x.goals.a), Number(x.xG.h), Number(x.xG.a)]);
  if (gravar(f, JSON.stringify(comp))) nUs++;
}
log('understat:', nUs, 'arquivos novos ou atualizados');
