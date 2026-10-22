/* Ponto Comum v3 · rede.js
 * Camada de dados: todas as competições acompanhadas, por clube, a partir dos placares públicos da ESPN.
 * Um jogo vira um registro compacto (placar de 90 min, gols por tempo, escanteios, chutes, cartões).
 * Cache no IndexedDB: anos passados ficam 30 dias; o ano corrente, 3 horas.
 */
(function (G) {
  'use strict';
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/';

  // radar 1 = na agenda do dia por padrão; 2 = opcional (desligada por padrão). As demais entram só no histórico
  // (força dos clubes, calendário), mas o radar mostra Champions + as 5 grandes ligas.
  const COMPS = [
    ['uefa.champions', 'Champions League', 'continental', 'uefa', 1], ['eng.1', 'Premier League', 'league', 'eng', 1], ['esp.1', 'LaLiga', 'league', 'esp', 1],
    ['ita.1', 'Serie A', 'league', 'ita', 1], ['ger.1', 'Bundesliga', 'league', 'ger', 1], ['fra.1', 'Ligue 1', 'league', 'fra', 1],
    ['bra.1', 'Brasileirão Série A', 'league', 'bra', 2], ['uefa.europa', 'Europa League', 'continental', 'uefa', 2],
    ['uefa.europa.conf', 'Conference League', 'continental', 'uefa', 2], ['conmebol.libertadores', 'Libertadores', 'continental', 'conmebol', 2],
    ['conmebol.sudamericana', 'Sul-Americana', 'continental', 'conmebol', 2],
    ['eng.2', 'Championship', 'league', 'eng', 0], ['esp.2', 'LaLiga 2', 'league', 'esp', 0], ['ger.2', '2. Bundesliga', 'league', 'ger', 0],
    ['ita.2', 'Serie B (Itália)', 'league', 'ita', 0], ['fra.2', 'Ligue 2', 'league', 'fra', 0], ['bra.2', 'Brasileirão Série B', 'league', 'bra', 0],
    ['por.1', 'Liga Portugal', 'league', 'por', 0], ['ned.1', 'Eredivisie', 'league', 'ned', 0], ['arg.1', 'Liga Profesional (ARG)', 'league', 'arg', 0],
    ['eng.fa', 'FA Cup', 'cup', 'eng', 0], ['eng.league_cup', 'Copa da Liga Inglesa', 'cup', 'eng', 0], ['esp.copa_del_rey', 'Copa del Rey', 'cup', 'esp', 0],
    ['ger.dfb_pokal', 'Copa da Alemanha', 'cup', 'ger', 0], ['ita.coppa_italia', 'Coppa Italia', 'cup', 'ita', 0], ['fra.coupe_de_france', 'Copa da França', 'cup', 'fra', 0],
    ['bra.copa_do_brazil', 'Copa do Brasil', 'cup', 'bra', 0], ['bra.camp.carioca', 'Campeonato Carioca', 'state', 'bra', 0],
    ['bra.camp.paulista', 'Campeonato Paulista', 'state', 'bra', 0], ['fifa.cwc', 'Mundial de Clubes', 'continental', 'fifa', 0]
  ].map(([id, nome, tipo, regiao, radar]) => Object.freeze({ id, nome, tipo, regiao, radar: radar === 1, opcional: radar === 2 }));
  const COMP_MAP = Object.freeze(Object.fromEntries(COMPS.map(c => [c.id, c])));
  // Na agenda, só jogos com pelo menos um destes clubes (os N mais fortes da liga pelo modelo). Premier e Champions: todos.
  const GRANDES_POR_LIGA = Object.freeze({ 'esp.1': 4, 'ita.1': 6, 'ger.1': 3, 'fra.1': 3 });
  const VERSAO_CACHE = 'v3|';

  const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const americana = v => { if (v === null || v === undefined) return null; const s = String(v).trim().toUpperCase(); if (s === 'EVEN' || s === 'EV') return 2; const n = Number(s.replace('+', '')); if (!Number.isFinite(n) || Math.abs(n) < 100) return null; return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n); };
  const fracionaria = v => { const s = String(v ?? '').trim(); if (/^evens?$/i.test(s)) return 2; const m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s); return m && +m[2] > 0 ? 1 + m[1] / m[2] : null; };
  const statOf = (side, name) => { const s = (side.statistics || []).find(x => x && x.name === name); return s ? num(s.displayValue ?? s.value) : null; };
  const byDate = (a, b) => Date.parse(a.date) - Date.parse(b.date) || (a.id < b.id ? -1 : 1);

  /* Odds da DraftKings que a ESPN anexa ao placar de jogos futuros (preço atual e abertura). */
  function oddsDoPlacar(o) {
    if (!o || typeof o !== 'object') return null;
    const ml = o.moneyline || {}, tt = o.total || {};
    const atual = s => s ? americana((s.close || s.current || {}).odds) : null, abre = s => s && s.open ? americana(s.open.odds) : null;
    const linha = s => { const v = s && (s.close || s.current || {}).line; const n = v ? Number(String(v).replace(/^[ou]/i, '')) : null; return Number.isFinite(n) ? n : null; };
    const r = { casa: (o.provider && o.provider.name) || 'Casa', h: atual(ml.home), d: atual(ml.draw), a: atual(ml.away), hA: abre(ml.home), dA: abre(ml.draw), aA: abre(ml.away),
      linha: linha(tt.over) ?? num(o.overUnder), over: atual(tt.over), under: atual(tt.under) };
    if (!r.h && o.homeTeamOdds) r.h = americana(o.homeTeamOdds.moneyLine);
    if (!r.a && o.awayTeamOdds) r.a = americana(o.awayTeamOdds.moneyLine);
    if (!r.d && o.drawOdds) r.d = americana(o.drawOdds.moneyLine);
    return (r.h && r.d && r.a) || (r.over && r.under) ? r : null;
  }

  function parseEvent(e, comp, observadoEm) {
    const c = e && e.competitions && e.competitions[0]; if (!c) return null;
    const list = c.competitors || [], H = list.find(x => x.homeAway === 'home'), A = list.find(x => x.homeAway === 'away');
    if (!H || !A || !H.team || !A.team) return null;
    const h = String(H.team.id || ''), a = String(A.team.id || '');
    if (!/^\d+$/.test(h) || !/^\d+$/.test(a) || h === a) return null;
    const type = (c.status && c.status.type) || {}, st = String(type.name || '');
    const m = { id: String(e.id), comp, date: e.date || c.date, h, a, hn: H.team.displayName || H.team.name || '', an: A.team.displayName || A.team.name || '',
      hs3: H.team.abbreviation || '', as3: A.team.abbreviation || '', neutral: c.neutralSite === true, st, state: type.state || '', done: false };
    if (!Number.isFinite(Date.parse(m.date))) return null;
    if (/CANCEL|POSTPON|ABANDON|SUSPEND|FORFEIT/i.test(st)) { m.void = true; return m; }
    if (!(type.completed === true && type.state === 'post')) {
      const od = oddsDoPlacar((c.odds || [])[0]);
      if (od) { od.em = observadoEm || new Date().toISOString(); m.odds = od; }
      return m;
    }
    const fh = num(H.score), fa = num(A.score);
    if (fh === null || fa === null || fh > 30 || fa > 30) return m;
    m.done = true; m.fh = fh; m.fa = fa;
    const prorrogacao = /AET|PEN|EXTRA|SHOOTOUT/i.test(st);
    const gols = [], am = {}, vm = {}, det = c.details || [];
    for (const d of det) {
      if (!d || d.shootout) continue;
      const tid = d.team ? String(d.team.id) : '', dv = String((d.clock && d.clock.displayValue) || ''), cv = num(d.clock && d.clock.value);
      if (d.scoringPlay) gols.push({ tid, own: d.ownGoal === true, dv, cv });
      else if (d.redCard) vm[tid] = (vm[tid] || 0) + 1;
      else if (d.yellowCard) am[tid] = (am[tid] || 0) + 1;
    }
    // Confere os gols do lance a lance com o placar final antes de usar a divisão por tempo.
    const conta = inverteContra => { let x = 0, y = 0; for (const g of gols) { let t = g.tid; if (inverteContra && g.own) t = t === h ? a : h; if (t === h) x++; else if (t === a) y++; } return [x, y]; };
    const c0 = conta(false), c1 = conta(true), conv = c0[0] === fh && c0[1] === fa ? 0 : c1[0] === fh && c1[1] === fa ? 1 : -1;
    const primeiroTempo = g => /^45'\+/.test(g.dv) || (g.cv !== null && g.cv < 2700) || (/^\d+'$/.test(g.dv) && parseInt(g.dv, 10) <= 45);
    const regulamentar = g => /^(45|90)'\+/.test(g.dv) || (g.cv !== null && g.cv <= 5400);
    if (conv >= 0) {
      let h1 = 0, a1 = 0, hr = 0, ar = 0, pg = null;
      const ordem = gols.slice().sort((x, y) => (x.cv ?? 1e9) - (y.cv ?? 1e9));
      for (const g of ordem) { let t = g.tid; if (conv && g.own) t = t === h ? a : h; const s = t === h ? 0 : t === a ? 1 : -1; if (s < 0) continue; if (primeiroTempo(g)) s ? a1++ : h1++; if (regulamentar(g)) { s ? ar++ : hr++; if (pg === null) pg = s ? 'a' : 'h'; } }
      m.h1 = h1; m.a1 = a1; m.hg = prorrogacao ? hr : fh; m.ag = prorrogacao ? ar : fa; m.pg = m.hg + m.ag === 0 ? '-' : pg;
    } else { m.h1 = null; m.a1 = null; m.pg = null; m.hg = prorrogacao ? null : fh; m.ag = prorrogacao ? null : fa; }
    m.hc = statOf(H, 'wonCorners'); m.ac = statOf(A, 'wonCorners');
    m.hsh = statOf(H, 'totalShots'); m.ash = statOf(A, 'totalShots');
    m.hst = statOf(H, 'shotsOnTarget'); m.ast = statOf(A, 'shotsOnTarget');
    m.hf = statOf(H, 'foulsCommitted'); m.af = statOf(A, 'foulsCommitted');
    const cartoesConhecidos = det.length > 0 || (fh + fa === 0 && m.hf !== null);
    m.hy = cartoesConhecidos ? (am[h] || 0) : null; m.ay = cartoesConhecidos ? (am[a] || 0) : null;
    m.hr = cartoesConhecidos ? (vm[h] || 0) : null; m.ar = cartoesConhecidos ? (vm[a] || 0) : null;
    return m;
  }

  /* ---------- IndexedDB (com queda silenciosa para memória) ---------- */
  const DB_NAME = 'ponto-comum-v2'; let dbp = null; const memoria = new Map();
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => { const d = r.result; for (const s of ['rede', 'kv', 'diario']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => null);
    return dbp;
  }
  function pedido(d, store, mode, fn) {
    return new Promise((res, rej) => { try { const tx = d.transaction(store, mode), req = fn(tx.objectStore(store)); tx.oncomplete = () => res(req.result); tx.onerror = tx.onabort = () => rej(tx.error); } catch (e) { rej(e); } });
  }
  const kv = {
    async get(store, key) { const mk = store + '|' + key, d = await db(); if (!d) return memoria.get(mk) ?? null; try { const v = await pedido(d, store, 'readonly', s => s.get(key)); return v === undefined ? (memoria.get(mk) ?? null) : v; } catch { return memoria.get(mk) ?? null; } },
    async put(store, key, value) { memoria.set(store + '|' + key, value); const d = await db(); if (!d) return false; try { await pedido(d, store, 'readwrite', s => s.put(value, key)); return true; } catch { return false; } },
    async del(store, key) { memoria.delete(store + '|' + key); const d = await db(); if (!d) return; try { await pedido(d, store, 'readwrite', s => s.delete(key)); } catch { /* a cópia em memória já foi removida */ } },
    async all(store) {
      try {
        const d = await db(); if (!d) throw new Error('sem IndexedDB');
        return await new Promise((res, rej) => { const out = [], tx = d.transaction(store, 'readonly'), req = tx.objectStore(store).openCursor(); req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); }; req.onerror = () => rej(req.error); });
      } catch { return [...memoria].filter(([k]) => k.startsWith(store + '|')).map(([k, v]) => [k.slice(store.length + 1), v]); }
    }
  };

  /* ---------- Rede HTTP ---------- */
  const memo = new Map();
  async function getJSON(url, { ttl = 0, signal, timeout = 20000 } = {}) {
    const hit = memo.get(url); if (ttl && hit && Date.now() - hit.at < ttl) return hit.data;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout), stop = () => ctl.abort();
    if (signal) signal.addEventListener('abort', stop, { once: true });
    try {
      const r = await fetch(url, { credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer', signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json(); if (ttl) { memo.set(url, { at: Date.now(), data }); if (memo.size > 300) memo.delete(memo.keys().next().value); }
      return data;
    } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', stop); }
  }
  async function pool(tasks, n) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; await tasks[k](); } })); }

  /* Arquivos que o robô do repositório publica junto com o site (dados/…). Fora do site publicado (arquivo local), não existem. */
  const temDadosLocais = () => typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  async function carregarDados(nome, { ttl = 0, timeout = 15000 } = {}) {
    if (!temDadosLocais()) return null;
    try { return await getJSON('dados/' + nome + (nome.includes('?') ? '&' : '?') + 'v=' + Math.floor(Date.now() / 600e3), { ttl, timeout }); } catch { return null; }
  }

  /* Carrega a rede inteira (30 competições × 3 anos). Primeiro tenta a base pronta publicada com o site (atualizada pelo robô
   * várias vezes por dia); o que faltar ou estiver velho vem da ESPN. Depois, quase tudo vem do cache do navegador. */
  async function carregarRede({ anos, forcar = false, onProgress = () => {}, signal } = {}) {
    const ano = new Date().getUTCFullYear(); anos = anos || [ano - 2, ano - 1, ano];
    const jogos = new Map(), relatorio = [], tarefas = [];
    const base = forcar ? null : await carregarDados('rede/indice.json'), baseNova = base && Date.now() - Date.parse(base.geradoEm) < 6 * 3600e3;
    const daBase = (comp, y) => { if (!base) return null; const a = base.arquivos.find(x => x.comp === comp && x.ano === y); return a && (y < ano || baseNova) ? a : null; };
    // Remove caches de versões anteriores (registros sem os campos novos).
    try { for (const [k] of await kv.all('rede')) if (!String(k).startsWith(VERSAO_CACHE)) await kv.del('rede', k); } catch { /* sem cache antigo */ }
    for (const c of COMPS) for (const y of anos) tarefas.push(async () => {
      const chave = VERSAO_CACHE + c.id + '|' + y, ttl = y < ano ? 30 * 864e5 : 3 * 3600e3, cache = await kv.get('rede', chave), arq = daBase(c.id, y);
      if (arq) {
        if (cache && cache.carimbo === arq.atualizadoEm) { for (const m of cache.jogos) jogos.set(m.id, m); relatorio.push({ comp: c.id, ano: y, ok: true, cache: true, base: true, n: cache.jogos.length }); onProgress(relatorio.length, tarefas.length); return; }
        const lista = await carregarDados('rede/' + arq.arquivo + '?c=' + encodeURIComponent(arq.atualizadoEm), { timeout: 30000 });
        if (Array.isArray(lista)) { for (const m of lista) jogos.set(m.id, m); await kv.put('rede', chave, { at: Date.now(), carimbo: arq.atualizadoEm, jogos: lista }); relatorio.push({ comp: c.id, ano: y, ok: true, base: true, n: lista.length }); onProgress(relatorio.length, tarefas.length); return; }
      }
      if (!forcar && cache && Date.now() - cache.at < ttl) { for (const m of cache.jogos) jogos.set(m.id, m); relatorio.push({ comp: c.id, ano: y, ok: true, cache: true, n: cache.jogos.length, em: new Date(cache.at).toISOString() }); onProgress(relatorio.length, tarefas.length); return; }
      try {
        const em = new Date().toISOString(), j = await getJSON(ESPN + c.id + '/scoreboard?dates=' + y + '&limit=1000', { signal }), lista = [];
        for (const e of j.events || []) { const m = parseEvent(e, c.id, em); if (m) lista.push(m); }
        for (const m of lista) jogos.set(m.id, m);
        await kv.put('rede', chave, { at: Date.now(), jogos: lista });
        relatorio.push({ comp: c.id, ano: y, ok: true, n: lista.length, em, truncado: (j.events || []).length >= 1000 });
      } catch (err) {
        if (signal && signal.aborted) throw err;
        if (cache) for (const m of cache.jogos) jogos.set(m.id, m);
        relatorio.push({ comp: c.id, ano: y, ok: false, antigo: !!cache, erro: String(err.message || err) });
      }
      onProgress(relatorio.length, tarefas.length);
    });
    await pool(tarefas, 6);
    return { jogos: [...jogos.values()].sort(byDate), relatorio, carregadaEm: new Date().toISOString() };
  }

  /* Agenda de um dia em São Paulo (consulta o dia anterior, o próprio e o seguinte para cobrir fusos). */
  const dataSP = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const somaDias = (dia, n) => new Date(Date.parse(dia + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  async function carregarDia(dia, comps = COMPS.filter(c => c.radar).map(c => c.id), { signal } = {}) {
    const dias = [-1, 0, 1].map(n => somaDias(dia, n).replaceAll('-', '')), out = new Map(), falhas = [], tarefas = [];
    for (const comp of comps) for (const d of dias) tarefas.push(async () => {
      try { const em = new Date().toISOString(), j = await getJSON(ESPN + comp + '/scoreboard?dates=' + d + '&limit=200', { ttl: 120e3, signal }); for (const e of j.events || []) { const m = parseEvent(e, comp, em); if (m && dataSP(m.date) === dia) out.set(m.id, m); } }
      catch (err) { if (signal && signal.aborted) throw err; falhas.push(comp + ' ' + d + ': ' + (err.message || err)); }
    });
    await pool(tarefas, 6);
    return { jogos: [...out.values()].sort(byDate), falhas };
  }

  /* Resumo da partida: odds de várias casas, escalações, desfalques, árbitro, estádio. */
  async function carregarResumo(m, { signal } = {}) {
    const j = await getJSON(ESPN + m.comp + '/summary?event=' + m.id, { ttl: 90e3, signal });
    if (String((j.header && j.header.id) || '') !== String(m.id)) throw new Error('A resposta pertence a outra partida.');
    const comp = (j.header.competitions || [])[0] || {}, st = (comp.status && comp.status.type) || {};
    const ids = [m.h, m.a];
    const escalacoes = (j.rosters || []).filter(r => ids.includes(String(r.team && r.team.id))).map(r => ({ time: String(r.team.id), formacao: String(r.formation || ''),
      titulares: [...(r.roster || []), ...(r.athletes || [])].filter(p => p.starter === true || p.starter === 'true').map(p => (p.athlete && (p.athlete.displayName || p.athlete.shortName)) || '').filter(Boolean) }));
    const desfalques = (j.injuries || []).filter(t => ids.includes(String(t.team && t.team.id))).flatMap(t => (t.injuries || []).slice(0, 25).map(i => ({ time: String(t.team.id), jogador: (i.athlete && i.athlete.displayName) || '', status: String(i.status || (i.type && i.type.description) || ''), detalhe: String(i.shortComment || '') }))).filter(x => x.jogador);
    const info = j.gameInfo || {}, arbitro = (info.officials || []).map(o => o.fullName || o.displayName).filter(Boolean)[0] || null;
    return { observadoEm: new Date().toISOString(), estado: st.state || '', status: st.name || '', inicio: comp.date || m.date, cotacoes: G.PCMercado ? G.PCMercado.doResumo(j, m) : [],
      escalacoes, desfalques, arbitro, estadio: info.venue ? info.venue.fullName || null : null };
  }

  /* Abertura e fechamento da DraftKings guardados pela ESPN — base do CLV e da validação contra o mercado. */
  async function carregarOddsFechamento(m, { signal } = {}) {
    const j = await getJSON(CORE + m.comp + '/events/' + m.id + '/competitions/' + m.id + '/odds', { ttl: 300e3, signal });
    const dk = (j.items || []).find(i => /draftkings/i.test((i.provider && i.provider.name) || '')); if (!dk) return null;
    const dec = o => o ? (americana(o.american ?? o.alternateDisplayValue) ?? (num(o.decimal) > 1 ? num(o.decimal) : null)) : null;
    const lado = (t, w) => t && t[w] && t[w].moneyLine ? dec(t[w].moneyLine) : null, out = { casa: dk.provider.name };
    for (const w of ['open', 'close']) {
      const b = dk[w] || {}, ln = b.total ? Number(String(b.total.american ?? b.total.alternateDisplayValue ?? '').replace(/^[ou]/i, '')) : null;
      out[w === 'open' ? 'abertura' : 'fechamento'] = { h: lado(dk.homeTeamOdds, w), d: b.draw ? dec(b.draw) : null, a: lado(dk.awayTeamOdds, w), linha: Number.isFinite(ln) ? ln : null, over: b.over ? dec(b.over) : null, under: b.under ? dec(b.under) : null };
    }
    return out;
  }

  /* Elenco com estatísticas da temporada atual e da anterior (gols, chutes, chutes no alvo, jogos, entradas do banco). */
  async function carregarElenco(liga, timeId, { signal } = {}) {
    const ano = new Date().getUTCFullYear(), mes = new Date().getUTCMonth() + 1, atual = liga === 'bra.1' || mes >= 7 ? ano : ano - 1;
    const ler = async temporada => {
      const j = await getJSON(ESPN + liga + '/teams/' + timeId + '/roster' + (temporada ? '?season=' + temporada : ''), { ttl: 6 * 3600e3, signal });
      return (j.athletes || []).map(a => {
        const st = {}; for (const c of ((a.statistics && a.statistics.splits && a.statistics.splits.categories) || [])) for (const s of (c.stats || [])) st[s.name] = num(s.value ?? s.displayValue);
        return { id: String(a.id), nome: a.displayName || a.shortName || '', pos: (a.position && a.position.abbreviation) || '', jogos: st.appearances || 0, banco: st.subIns || 0, gols: st.totalGoals || 0, chutes: st.totalShots || 0, noAlvo: st.shotsOnTarget || 0, assist: st.goalAssists || 0, lesionado: Array.isArray(a.injuries) && a.injuries.length > 0 };
      }).filter(p => p.nome);
    };
    const [agora, antes] = await Promise.all([ler(null), ler(atual - 1).catch(() => [])]);
    return { liga, timeId, atual: agora, anterior: antes };
  }

  /* ---------- Consultas sobre a rede ---------- */
  function indexar(jogos) {
    const porTime = new Map();
    for (const m of jogos) { if (m.void) continue; for (const t of [m.h, m.a]) { let l = porTime.get(t); if (!l) porTime.set(t, l = []); l.push(m); } }
    return porTime;
  }
  function calendario(porTime, time, ref, { antes = 6, depois = 3 } = {}) {
    const lista = porTime.get(time) || [], t = Date.parse(ref);
    const prev = lista.filter(m => m.done && Date.parse(m.date) < t).slice(-antes).reverse(), prox = lista.filter(m => !m.done && Date.parse(m.date) > t).slice(0, depois);
    const ultimo = prev[0] ? Date.parse(prev[0].date) : null, proximo = prox[0] ? Date.parse(prox[0].date) : null;
    const em = dias => lista.filter(m => m.done && Date.parse(m.date) < t && Date.parse(m.date) >= t - dias * 864e5).length;
    return { anteriores: prev, proximos: prox, descanso: ultimo ? (t - ultimo) / 864e5 : null, ateProximo: proximo ? (proximo - t) / 864e5 : null, jogos14: em(14), jogos30: em(30) };
  }
  function confrontos(porTime, h, a, ref, max = 8) {
    const t = Date.parse(ref);
    return (porTime.get(h) || []).filter(m => m.done && Date.parse(m.date) < t && ((m.h === h && m.a === a) || (m.h === a && m.a === h))).slice(-max).reverse();
  }
  function forma(porTime, time, ref, n = 10) {
    const t = Date.parse(ref), ult = (porTime.get(time) || []).filter(m => m.done && m.hg != null && Date.parse(m.date) < t).slice(-n);
    let v = 0, e = 0, d = 0, gp = 0, gc = 0, cs = 0, btts = 0, o25 = 0, chA = 0, chC = 0, nch = 0, esc = 0, nesc = 0;
    for (const m of ult) {
      const casa = m.h === time, pro = casa ? m.hg : m.ag, contra = casa ? m.ag : m.hg;
      if (pro > contra) v++; else if (pro === contra) e++; else d++;
      gp += pro; gc += contra; if (!contra) cs++; if (pro && contra) btts++; if (pro + contra > 2.5) o25++;
      if (m.hst != null && m.ast != null) { chA += casa ? m.hst : m.ast; chC += casa ? m.ast : m.hst; nch++; }
      if (m.hc != null && m.ac != null) { esc += casa ? m.hc : m.ac; nesc++; }
    }
    const n2 = ult.length || 1;
    return { n: ult.length, v, e, d, gp: gp / n2, gc: gc / n2, semSofrer: cs, ambas: btts, over25: o25, chutesNoAlvo: nch ? chA / nch : null, chutesNoAlvoContra: nch ? chC / nch : null, escanteios: nesc ? esc / nesc : null,
      seq: ult.slice().reverse().map(m => { const casa = m.h === time, p = casa ? m.hg : m.ag, c = casa ? m.ag : m.hg; return p > c ? 'V' : p === c ? 'E' : 'D'; }).join('') };
  }

  G.PCRede = Object.freeze({ carregarDados, ESPN, CORE, COMPS, COMP_MAP, GRANDES_POR_LIGA, americana, fracionaria, num, parseEvent, oddsDoPlacar, carregarRede, carregarDia, carregarResumo, carregarOddsFechamento, carregarElenco,
    indexar, calendario, confrontos, forma, kv, getJSON, pool, dataSP, somaDias });
})(typeof globalThis !== 'undefined' ? globalThis : window);
