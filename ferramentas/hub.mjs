// Carrega os módulos do hub (os mesmos arquivos do site) dentro do Node, sem navegador.
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULOS = ['rede.js', 'modelo.js', 'mercado.js', 'analise.js', 'bilhete.js', 'diario.js', 'validacao.js'];

export function carregarHub({ semRede = false } = {}) {
  const armazenamento = new Map();
  const ctx = vm.createContext({
    console, Intl, Date, Math, JSON, Map, Set, Float64Array, Int32Array, Uint8Array, Promise, URL, AbortController, performance, setTimeout, clearTimeout,
    fetch: semRede ? async () => { throw new Error('sem rede'); } : fetch,
    localStorage: { getItem: k => armazenamento.get(k) ?? null, setItem: (k, v) => armazenamento.set(k, String(v)), removeItem: k => armazenamento.delete(k) }
  });
  ctx.globalThis = ctx;
  for (const f of MODULOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', f), 'utf8'), ctx, { filename: f });
  return { R: ctx.PCRede, M: ctx.PCModelo, K: ctx.PCMercado, A: ctx.PCAnalise, B: ctx.PCBilhete, D: ctx.PCDiario, V: ctx.PCValidacao, ctx };
}

export const lerJSON = (f, padrao = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
export function gravarJSON(f, dados, { compacto = true } = {}) {
  const txt = compacto ? JSON.stringify(dados) : JSON.stringify(dados, null, 1);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const antes = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  if (antes === txt) return false;
  fs.writeFileSync(f, txt); return true;
}

/* Base de jogos a partir de dados/rede (sem consultar a ESPN). */
export function lerRede(dir = path.join(RAIZ, 'dados', 'rede')) {
  const indice = lerJSON(path.join(dir, 'indice.json')); if (!indice) return null;
  const jogos = new Map();
  for (const a of indice.arquivos) for (const m of lerJSON(path.join(dir, a.arquivo), [])) jogos.set(m.id, m);
  return { indice, jogos: [...jogos.values()].sort((x, y) => Date.parse(x.date) - Date.parse(y.date) || (x.id < y.id ? -1 : 1)) };
}
