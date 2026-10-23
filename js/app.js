/* Ponto Comum v3 · app.js — interface. Depende de rede, modelo, mercado, analise, bilhete, diario e validacao. */
(() => {
  'use strict';
  const R = PCRede, M = PCModelo, K = PCMercado, A = PCAnalise, B = PCBilhete, D = PCDiario, V = PCValidacao;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (p, d = 0) => Number.isFinite(p) ? (p * 100).toFixed(d).replace('.', ',') + '%' : '—';
  const num = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—';
  const reais = v => Number.isFinite(v) ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
  const sinal = v => Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(1).replace('.', ',') + '%' : '—';
  const hora = iso => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const dia = iso => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
  const diaHora = iso => dia(iso) + ' ' + hora(iso);
  const nomeComp = id => (R.COMP_MAP[id] || {}).nome || id;
  const hojeSP = () => R.dataSP(new Date().toISOString());
  const pausa = () => new Promise(r => setTimeout(r, 0));
  const CHAVE_PREF = 'pc3-preferencias';
  const NIVEL_NOME = { simples: 'Simples', multipla: 'Múltipla', segura: 'Segura (antigo)', media: 'Média (antigo)', arriscada: 'Arriscada (antigo)', bingo: 'Bingo (antigo)', manual: 'Montado por você' };
  const TIPO_PALPITE = { valor: 'Valor', principal: 'Principal', oddMaior: 'Odd maior', destaque: 'Fora do normal', jogador: 'Jogador marca' };

  const S = {
    jogos: [], porId: new Map(), porTime: new Map(), F: null, Fe: null, Fc: null, forca: null, dia: hojeSP(), agenda: [], falhasAgenda: [],
    comps: new Set(R.COMPS.filter(c => c.radar).map(c => c.id)), todos: false, grandes: new Map(), idsGrandes: new Set(), sel: new Set(), analises: new Map(), elencos: new Map(), aba: 'radar',
    rede: { status: 'parado', progresso: null, relatorio: [], carregadaEm: null, ajustadaEm: null, erro: null },
    familia: {}, palpitesDia: null, backtest: null, validacao: null, valPublicada: null, revisao: null, rodando: false, foco: null
  };

  function lerPref() { try { const p = JSON.parse(localStorage.getItem(CHAVE_PREF) || '{}'); if (Array.isArray(p.comps) && p.comps.length) S.comps = new Set(p.comps.filter(c => R.COMP_MAP[c] && (R.COMP_MAP[c].radar || R.COMP_MAP[c].opcional))); S.todos = !!p.todos; } catch { /* preferências padrão */ } }
  function gravarPref() { try { localStorage.setItem(CHAVE_PREF, JSON.stringify({ comps: [...S.comps], todos: S.todos })); } catch { /* sem armazenamento local */ } }
  let toastT; function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 4200); }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch { /* sem permissão: usa o método antigo */ }
    const t = document.createElement('textarea'); t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } t.remove(); return ok;
  }
  function baixar(nome, texto, tipo = 'application/json') { const url = URL.createObjectURL(new Blob([texto], { type: tipo })), a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }

  /* ---------- Dados e modelos ---------- */
  function indexar() { S.porId = new Map(S.jogos.map(m => [m.id, m])); S.porTime = R.indexar(S.jogos); }
  function mesclar(lista) { let mudou = false; for (const m of lista) { const v = S.porId.get(m.id); if (!v) { S.jogos.push(m); mudou = true; } else if (v.st !== m.st || v.done !== m.done || m.odds) { Object.assign(v, m); mudou = true; } } if (mudou) { S.jogos.sort((a, b) => Date.parse(a.date) - Date.parse(b.date)); indexar(); } }
  /* Os N clubes mais fortes de cada liga (pelo modelo) — o filtro de grandes do radar. Premier e Champions: todos. */
  function calcularGrandes() {
    S.grandes = new Map(); if (!S.forca) return;
    for (const [liga, n] of Object.entries(R.GRANDES_POR_LIGA)) S.grandes.set(liga, S.forca.lista.filter(x => x.grupo === 'L:' + liga).slice(0, n));
    S.idsGrandes = new Set([...S.grandes.values()].flat().map(x => x.id));
  }
  const filtraGrandes = m => S.todos || !R.GRANDES_POR_LIGA[m.comp] || !S.idsGrandes.size || S.idsGrandes.has(m.h) || S.idsGrandes.has(m.a);
  async function carregarRedeEModelos(forcar = false) {
    S.rede.status = 'carregando'; S.rede.erro = null; renderStatus();
    try {
      const r = await R.carregarRede({ forcar, onProgress: (d, t) => { S.rede.progresso = [d, t]; renderStatus(); } });
      S.jogos = r.jogos; S.rede.relatorio = r.relatorio; S.rede.carregadaEm = r.carregadaEm; indexar(); mesclar(S.agenda);
      S.rede.status = 'ajustando'; renderStatus(); await pausa();
      const p = await R.kv.get('kv', 'parametros'), cfg = p && p.aplicar ? { halfLife: p.meiaVida, sotBlend: p.pesoChutesNoAlvo, esticar: p.correcao } : {};
      S.F = M.ajustarGols(S.jogos, cfg); await pausa();
      S.Fe = M.ajustarContagem(S.jogos, 'escanteios'); await pausa();
      S.Fc = M.ajustarContagem(S.jogos, 'cartoes'); S.forca = M.tabelaForca(S.F); calcularGrandes();
      S.rede.status = 'pronto'; S.rede.ajustadaEm = new Date().toISOString();
      for (const [id, a] of S.analises) S.analises.set(id, A.analisar(S.porId.get(id) || a.m, ctxAnalise(a.m, a.cotacoes, a.resumo)));
    } catch (e) { S.rede.status = 'erro'; S.rede.erro = e.message || String(e); }
    renderStatus(); render(); if (S.aba === 'palpites') carregarPalpites();
  }
  async function carregarAgenda() {
    const msg = $('#radar-msg'); if (msg) msg.textContent = 'Buscando a agenda de ' + S.dia.split('-').reverse().join('/') + '…';
    try { const r = await R.carregarDia(S.dia, [...S.comps]); S.agenda = r.jogos; S.falhasAgenda = r.falhas; if (S.jogos.length) mesclar(r.jogos); }
    catch (e) { S.agenda = []; S.falhasAgenda = [e.message || String(e)]; }
    renderRadar(); if (S.aba === 'palpites') carregarPalpites();
  }
  const ctxAnalise = (m, cotacoes, resumo) => ({ F: S.F, Fe: S.Fe, Fc: S.Fc, porTime: S.porTime, forca: S.forca, cotacoes, resumo, elencos: S.elencos.get(m.id) || {} });
  function juntarCotacoes(a, b) { const visto = new Set(a.map(q => q.casa + '|' + K.chave(q.mk))); return a.concat(b.filter(q => !visto.has(q.casa + '|' + K.chave(q.mk)))); }
  /* Liga do elenco: a liga doméstica do clube pelo modelo; sem ela, a competição do jogo. */
  function ligaDoTime(id, comp) { const g = S.forca && S.forca.porId.get(id) ? S.forca.porId.get(id).grupo : null; return g && g.startsWith('L:') ? g.slice(2) : comp; }
  async function elencosDe(m) {
    if (S.elencos.has(m.id)) return S.elencos.get(m.id);
    const ler = id => R.carregarElenco(ligaDoTime(id, m.comp), id).catch(() => null), [casa, fora] = await Promise.all([ler(m.h), ler(m.a)]), e = { casa, fora };
    S.elencos.set(m.id, e); return e;
  }
  async function analisarLista(lista) {
    let capturadas = 0;
    await R.pool(lista.map(m => async () => {
      let resumo = null, cot = K.doPlacar(m);
      const [rs] = await Promise.all([R.carregarResumo(m).catch(e => ({ erro: e.message || String(e), cotacoes: [] })), elencosDe(m)]);
      resumo = rs; cot = juntarCotacoes(resumo.cotacoes || [], cot);
      const a = A.analisar(m, ctxAnalise(m, cot, resumo)); S.analises.set(m.id, a);
      if (!a.iniciado) { const n = await D.capturar(a).catch(() => 0); capturadas += n; }
    }), 3);
    return capturadas;
  }
  async function analisar(ids) {
    if (!S.F) { toast('O modelo ainda está sendo ajustado. A análise começa quando a rede terminar de carregar.'); return; }
    const lista = ids.map(id => S.porId.get(id) || S.agenda.find(m => m.id === id)).filter(Boolean); if (!lista.length) return;
    navegar('analise'); const el = $('#analise'); el.innerHTML = '<p class="carregando">Analisando ' + lista.length + ' partida(s): odds, elencos e contexto…</p>';
    const capturadas = await analisarLista(lista);
    S.foco = lista[0].id; render();
    if (capturadas) toast(capturadas + ' previsões registradas no diário antes do jogo.');
  }

  /* ---------- Navegação ---------- */
  const ABAS = ['radar', 'palpites', 'analise', 'bilhete', 'diario', 'validacao'];
  function navegar(aba) { if (!ABAS.includes(aba)) aba = 'radar'; S.aba = aba; if (aba === 'palpites') setTimeout(carregarPalpites, 0); $$('.vista').forEach(v => { v.hidden = v.id !== aba; }); $$('[data-aba]').forEach(a => a.classList.toggle('ativa', a.dataset.aba === aba)); if (location.hash.slice(1) !== aba) history.replaceState(null, '', '#' + aba); render(); }
  function render() { renderStatus(); $('#n-bilhete').textContent = B.lista().length; if (S.aba === 'radar') renderRadar(); else if (S.aba === 'palpites') renderPalpites(); else if (S.aba === 'analise') renderAnalise(); else if (S.aba === 'bilhete') renderBilhete(); else if (S.aba === 'diario') renderDiario(); else renderValidacao(); }

  function renderStatus() {
    const r = S.rede, el = $('#status-rede'); let t = '';
    if (r.status === 'carregando') t = '<span class="pulso"></span> Carregando a rede de jogos' + (r.progresso ? ' · ' + r.progresso[0] + '/' + r.progresso[1] + ' consultas' : '') + '. Na primeira vez leva até um minuto; depois vem do cache.';
    else if (r.status === 'ajustando') t = '<span class="pulso"></span> Ajustando o modelo de força com ' + S.jogos.filter(m => m.done).length.toLocaleString('pt-BR') + ' jogos…';
    else if (r.status === 'pronto') { const f = r.relatorio.filter(x => !x.ok).length; t = '<span class="ok"></span> Rede: ' + S.jogos.filter(m => m.done).length.toLocaleString('pt-BR') + ' jogos de ' + R.COMPS.length + ' competições · modelo ajustado às ' + hora(r.ajustadaEm) + (f ? ' · ' + f + ' consulta(s) falharam' : '') + ' <button class="link" id="recarregar">Atualizar</button>'; }
    else if (r.status === 'erro') t = '<span class="erro"></span> Falha ao carregar a rede: ' + esc(r.erro) + ' <button class="link" id="recarregar">Tentar de novo</button>';
    el.innerHTML = t;
  }

  /* ---------- Radar ---------- */
  function previsaoRapida(m) {
    if (!S.F) return null; const p = M.prever(S.F, m), Mx = M.matriz(p.lh, p.la, S.F.rho);
    let h = 0, d = 0, a = 0; for (let i = 0; i < Mx.length; i++) for (let j = 0; j < Mx.length; j++) { const v = Mx[i][j]; if (i > j) h += v; else if (i < j) a += v; else d += v; }
    let mk = null; if (m.odds && m.odds.h && m.odds.d && m.odds.a) mk = K.semMargem([m.odds.h, m.odds.d, m.odds.a]).p;
    return { lh: p.lh, la: p.la, mod: [h, d, a], mk };
  }
  function barra3(p, cls = '') { return '<span class="barra3 ' + cls + '"><i style="width:' + (p[0] * 100).toFixed(1) + '%"></i><i style="width:' + (p[1] * 100).toFixed(1) + '%"></i><i style="width:' + (p[2] * 100).toFixed(1) + '%"></i></span>'; }
  function renderRadar() {
    const el = $('#radar'); if (!el || S.aba !== 'radar') return;
    const doDia = S.agenda.filter(m => S.comps.has(m.comp)), jogos = doDia.filter(filtraGrandes), escondidos = doDia.length - jogos.length;
    const chip = c => '<label class="chip"><input type="checkbox" data-comp="' + c.id + '"' + (S.comps.has(c.id) ? ' checked' : '') + '> ' + esc(c.nome) + '</label>';
    const grandes = [...S.grandes.entries()].map(([liga, l]) => '<li><b>' + esc(nomeComp(liga)) + ':</b> ' + (l.length ? l.map(x => esc(x.nome)).join(', ') : '—') + '</li>').join('');
    const linhas = jogos.map(m => {
      const q = previsaoRapida(m), fc = S.forca && S.forca.porId.get(m.h), ff = S.forca && S.forca.porId.get(m.a), comecou = m.done || m.state === 'in' || Date.parse(m.date) <= Date.now();
      const placar = m.done ? '<b class="placar">' + m.fh + '–' + m.fa + '</b>' : m.state === 'in' ? '<b class="ao-vivo">ao vivo</b>' : '<span class="hora">' + hora(m.date) + '</span>';
      return '<tr class="' + (comecou ? 'passado' : '') + '"><td><input type="checkbox" data-sel="' + m.id + '"' + (S.sel.has(m.id) ? ' checked' : '') + ' aria-label="Selecionar ' + esc(m.hn + ' × ' + m.an) + '"></td><td>' + placar + '</td>'
        + '<td><button class="jogo" data-analisar="' + m.id + '"><span>' + esc(m.hn) + (fc ? ' <small>' + fc.posicao + 'º</small>' : '') + '</span><span>' + esc(m.an) + (ff ? ' <small>' + ff.posicao + 'º</small>' : '') + '</span></button><small class="comp">' + esc(nomeComp(m.comp)) + '</small></td>'
        + '<td>' + (q ? barra3(q.mod) + '<b class="nw">' + q.mod.map(v => pct(v)).join(' · ') + '</b>' + (q.mk ? '<small class="nw">mercado ' + q.mk.map(v => pct(v)).join(' · ') + '</small>' : '<small>sem odd</small>') : '<small>modelo carregando</small>') + '</td>'
        + '<td class="num">' + (q ? num(q.lh) + ' × ' + num(q.la) + '<small>total ' + num(q.lh + q.la) + '</small>' : '—') + '</td></tr>';
    }).join('');
    const msg = jogos.length ? jogos.length + ' partidas' + (escondidos ? ' · ' + escondidos + ' escondida(s) por não ter um dos grandes da liga' : '') + '. A posição ao lado do nome é a força do clube entre ' + (S.forca ? S.forca.lista.length.toLocaleString('pt-BR') : '…') + ' clubes ativos da rede.'
      : S.falhasAgenda.length && !doDia.length ? 'A agenda não respondeu: ' + esc(S.falhasAgenda.slice(0, 2).join(' · ')) : escondidos ? 'Nenhuma partida com os grandes nesta data (' + escondidos + ' escondida(s)).' : 'Nenhuma partida nas competições selecionadas nesta data.';
    el.innerHTML = '<div class="cabeca"><div><p class="sobre">AGENDA · ' + esc(S.dia.split('-').reverse().join('/')) + ' · HORÁRIO DE SÃO PAULO</p><h1>Radar do dia</h1></div><div class="acoes"><button class="sec" id="sel-todos">Selecionar pré-jogo</button><button class="pri" id="analisar-sel">Analisar selecionados (' + S.sel.size + ')</button></div></div>'
      + '<details class="filtro"><summary>Competições e filtro de grandes</summary><p class="sobre">NO RADAR</p><div class="chips">' + R.COMPS.filter(c => c.radar).map(chip).join('') + '</div><p class="sobre" style="margin-top:12px">OPCIONAIS</p><div class="chips">' + R.COMPS.filter(c => c.opcional).map(chip).join('') + '</div>'
      + '<label class="chk" style="margin-top:12px"><input type="checkbox" id="mostrar-todos"' + (S.todos ? ' checked' : '') + '> mostrar todos os jogos (sem o filtro de grandes)</label>'
      + '<p class="nota">Premier League e Champions: todos os jogos. LaLiga, Serie A, Bundesliga e Ligue 1: só jogos com pelo menos um dos clubes mais fortes da liga pelo modelo (calculado a cada atualização):</p>' + (grandes ? '<ul class="lista">' + grandes + '</ul>' : '<p class="nota">A lista aparece quando o modelo terminar de ajustar.</p>') + '</details>'
      + '<p class="nota" id="radar-msg">' + msg + '</p>'
      + (jogos.length ? '<div class="tabela"><table class="radar"><thead><tr><th></th><th>Hora</th><th>Partida</th><th>Modelo · 1 X 2</th><th class="num">Gols esperados</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' : '')
      + '<p class="nota">Modelo = força dos clubes em todas as competições. Mercado = DraftKings sem a margem da casa. Clique numa partida para a análise completa.</p>';
  }

  /* ---------- Análise ---------- */
  const OUTRAS = [['times', 'Gols por time e handicap', l => ['tm', 'ah'].includes(l.mk.t)], ['tempos', 'Tempos e 1º gol', l => l.familia === 'tempos'], ['escanteios', 'Escanteios', l => l.familia === 'escanteios'], ['cartoes', 'Cartões', l => l.familia === 'cartoes']];
  const trivial = (l, lim) => l.pModelo > lim || l.pModelo < 1 - lim;
  function tipoOdd(l) {
    if (l.oddTipo === 'cotada') return (l.oddCasas.length > 1 ? 'média de ' + l.oddCasas.length + ' casas' : esc(l.oddCasas[0] || 'casa')) + (l.oddMaior && l.oddMaior > l.odd + 0.005 ? ' · maior ' + num(l.oddMaior) : '');
    return l.oddTipo === 'mercado' ? 'estimada pelo mercado' : 'estimada pelo modelo';
  }
  function linhaTabela(a, l) {
    const naBilhete = B.lista().some(p => p.id === a.m.id + '|' + l.chave), evCls = l.ev === null || l.oddTipo !== 'cotada' ? '' : l.ev > 0.03 ? 'pos' : l.ev < -0.08 ? 'neg' : '';
    const faixa = l.faixa ? '<small>' + pct(l.faixa[0]) + '–' + pct(l.faixa[1]) + '</small>' : '';
    const tag = l.concorda === false ? '<span class="tag div">diverge ' + Math.round(Math.abs(l.divergencia) * 100) + ' p.p.</span>' : '';
    return '<tr><td>' + esc(l.rotulo) + tag + '</td><td class="num"><b>' + pct(l.pModelo, 1) + '</b>' + faixa + '</td><td class="num">' + pct(l.pMercado, 1) + '</td>'
      + '<td class="num"><b>' + num(l.odd) + '</b><small>' + tipoOdd(l) + '</small></td><td class="num">' + num(l.justa) + '</td><td class="num ' + evCls + '">' + (l.oddTipo === 'cotada' ? sinal(l.ev) : '<small>só com odd cotada</small>') + '</td>'
      + '<td><button class="add' + (naBilhete ? ' ja' : '') + '" data-add="' + a.m.id + '|' + esc(l.chave) + '" title="' + (naBilhete ? 'Já está no bilhete' : 'Adicionar ao bilhete') + '">' + (naBilhete ? '✓' : '+') + '</button></td></tr>';
  }
  const CAB = '<thead><tr><th>Linha</th><th class="num">Modelo <small>faixa 90%</small></th><th class="num">Mercado</th><th class="num">Odd sugerida</th><th class="num">Odd justa</th><th class="num">Valor (modelo)</th><th></th></tr></thead>';
  const fortes = a => { const porTipo = new Map(); for (const l of a.linhas.filter(l => ['1x2', 'dc', 'btts', 'tot'].includes(l.mk.t) && !(l.mk.t === 'btts' && l.mk.s === 'n') && l.pModelo >= 0.55 && l.pModelo <= 0.88 && l.concorda !== false).sort((x, y) => Math.abs(x.pModelo - 0.7) - Math.abs(y.pModelo - 0.7))) if (!porTipo.has(l.mk.t)) porTipo.set(l.mk.t, l); return [...porTipo.values()]; };
  function leitura(a) {
    const out = [], ref = a.ref, m = a.m, fc = a.forca.casa, ff = a.forca.fora;
    out.push('Modelo: gols esperados ' + num(a.lh) + ' × ' + num(a.la) + (fc && ff ? '; força na rede: ' + esc(m.hn) + ' ' + fc.posicao + 'º, ' + esc(m.an) + ' ' + ff.posicao + 'º.' : '.') + (ref ? ' Mercado (' + esc(ref.fonte) + '): ' + num(ref.lh) + ' × ' + num(ref.la) + '.' : ''));
    const f = fortes(a);
    if (f.length) out.push('Nos seus mercados (55% a 88%, modelo e mercado de acordo): ' + f.map(l => esc(l.rotulo) + ' <b>' + pct(l.pModelo) + '</b> a ' + num(l.odd)).join('; ') + '.');
    else out.push('<b>Nada bom neste jogo</b> pelos critérios do hub: nenhuma linha dos seus mercados fica entre 55% e 88% com modelo e mercado de acordo.');
    const valor = a.linhas.filter(l => l.principal && l.oddTipo === 'cotada' && l.ev !== null && l.ev > 0.05 && l.concorda !== false).sort((x, y) => y.ev - x.ev);
    if (valor.length) out.push('Odd acima do justo pelo modelo: ' + valor.slice(0, 3).map(l => esc(l.rotulo) + ' a ' + num(l.odd) + ' (' + sinal(l.ev) + ')').join('; ') + '. É sinal, não garantia: veja a Validação.');
    return out;
  }
  function blocoCalendario(a, lado) {
    const c = a.calendario[lado], f = a.forma[lado], nome = lado === 'casa' ? a.m.hn : a.m.an, eu = lado === 'casa' ? a.m.h : a.m.a;
    const ant = c.anteriores.map(j => { const casa = j.h === eu, adv = casa ? j.an : j.hn, adId = casa ? j.a : j.h, pos = S.forca && S.forca.porId.get(adId), p = casa ? j.hg ?? j.fh : j.ag ?? j.fa, q = casa ? j.ag ?? j.fa : j.hg ?? j.fh, r = p > q ? 'V' : p === q ? 'E' : 'D';
      return '<li><span class="res ' + r + '">' + r + '</span>' + dia(j.date) + ' · ' + (casa ? 'casa' : 'fora') + ' · ' + esc(adv) + (pos ? ' <small>(' + pos.posicao + 'º)</small>' : '') + ' <b>' + p + '–' + q + '</b> <small>' + esc(nomeComp(j.comp)) + '</small></li>'; }).join('');
    const prox = c.proximos.map(j => '<li>' + diaHora(j.date) + ' · ' + esc(j.h === eu ? j.an : j.hn) + ' <small>' + esc(nomeComp(j.comp)) + '</small></li>').join('');
    return '<div class="time"><h4>' + esc(nome) + '</h4><p class="nota">Últimos ' + f.n + ' (todas as competições): <b>' + esc(f.seq) + '</b> · ' + num(f.gp, 1) + ' gols feitos e ' + num(f.gc, 1) + ' sofridos por jogo · ambas marcaram ' + f.ambas + '/' + f.n + ' · over 2,5 em ' + f.over25 + '/' + f.n
      + (f.chutesNoAlvo !== null ? ' · ' + num(f.chutesNoAlvo, 1) + ' chutes no alvo (' + num(f.chutesNoAlvoContra, 1) + ' contra)' : '') + '</p><p class="nota">Descanso: ' + (c.descanso !== null ? num(c.descanso, 1) + ' dias' : '—') + ' · ' + c.jogos14 + ' jogos em 14 dias' + (c.ateProximo !== null ? ' · próximo jogo em ' + num(c.ateProximo, 1) + ' dias' : '') + '</p><ul class="lista">' + ant + '</ul>' + (prox ? '<p class="sobre">PRÓXIMOS</p><ul class="lista">' + prox + '</ul>' : '') + '</div>';
  }
  function blocoJogadores(a) {
    const temOdd = a.jogadores.casaOdds;
    const linha = j => '<li><b>' + esc(j.nome) + '</b> ' + (j.pos ? '<small>' + esc(j.pos) + (j.jogos ? ' · ' + j.gols + ' gol(s) em ' + j.jogos + ' jogos' : '') + '</small> ' : '') + '· modelo ' + (j.p !== null && j.p !== undefined ? pct(j.p) : '—')
      + (j.odd ? ' · <b>odd ' + num(j.odd) + '</b> <small>' + esc(temOdd) + ' (' + pct(1 / j.odd) + ' com margem)</small>' : j.p ? ' <small>odd justa ~' + num(1 / j.p) + '</small>' : '') + '</li>';
    const lado = (lista, nome) => '<div><h4>' + esc(nome) + '</h4>' + (lista.length ? '<ul class="lista">' + lista.map(linha).join('') + '</ul>' : '<p class="nota">Elenco indisponível na fonte.</p>') + '</div>';
    return '<details class="contexto"><summary>Quem pode marcar' + (temOdd ? ' <small>com odds da ' + esc(temOdd) + '</small>' : ' <small>(sem odds de jogador para este jogo)</small>') + '</summary><div class="dois">' + lado(a.jogadores.casa, a.m.hn) + lado(a.jogadores.fora, a.m.an) + '</div><p class="nota">Modelo: parcela do jogador nos gols e chutes no alvo do time (temporada atual + metade da anterior), por jogo como titular, aplicada aos gols esperados do time; supõe que ele começa jogando. A odd é a de marcar a qualquer momento; a chance implícita nela inclui a margem da casa, que nesse mercado é alta. O robô está registrando essas odds e quem marcou para validar o modelo de jogador.</p></details>';
  }
  /* ---------- Melhores apostas do jogo ---------- */
  function linhaPalpite(a, tipo, x) {
    const m = a.m, P = a.palpites;
    if (tipo === 'jogador') return '<li><span class="tipo">' + TIPO_PALPITE[tipo] + '</span><span><b>' + esc(x.nome) + ' marca</b> <small>modelo ' + pct(x.p) + ' · odd ' + num(x.odd) + ' ' + esc(a.jogadores.casaOdds || '') + '</small></span></li>';
    const ch = P.chance(x), naB = B.lista().some(p => p.id === m.id + '|' + x.chave);
    if (tipo === 'valor') return '<li class="valor"><span class="tipo">Valor</span><span><b>' + esc(x.rotulo) + '</b> · <b>odd ' + num(x.oddOutra) + '</b> <small>na ' + esc(x.casaOutra || '') + ' · preço justo da Pinnacle ' + num(1 / x.pPinnacle) + ' (' + pct(x.pPinnacle) + ') · ' + sinal(P.valorPin) + ' acima · modelo ' + pct(x.pModelo) + '</small></span><button class="add' + (naB ? ' ja' : '') + '" data-add="' + m.id + '|' + esc(x.chave) + '" title="Adicionar ao bilhete">' + (naB ? '✓' : '+') + '</button></li>';
    const melhor = x.oddTipo === 'cotada' && x.oddMaior && x.oddCasas.length > 1 ? x.oddMaior : x.odd;
    return '<li><span class="tipo">' + TIPO_PALPITE[tipo] + '</span><span><b>' + esc(x.rotulo) + '</b> · <b>odd ' + num(melhor) + '</b> <small>' + (x.oddTipo === 'cotada' ? (x.oddCasas.length > 1 ? 'melhor odd, na ' + esc(x.casaMaior || '') + ' (média ' + num(x.odd) + ')' : esc(x.oddCasas[0] || '')) : 'odd estimada: confira na sua casa') + ' · chance ' + pct(ch) + ' (modelo ' + pct(x.pModelo) + (Number.isFinite(x.pMercado) ? ', mercado ' + pct(x.pMercado) : ', sem mercado') + ')' + (tipo === 'destaque' && x.pTipico !== null ? ' · normal da competição ' + pct(x.pTipico) : '') + '</small></span><button class="add' + (naB ? ' ja' : '') + '" data-add="' + m.id + '|' + esc(x.chave) + '" title="Adicionar ao bilhete">' + (naB ? '✓' : '+') + '</button></li>';
  }
  function blocoPalpites(a) {
    const P = a.palpites; if (!P) return '';
    const itens = ['valor', 'principal', 'oddMaior', 'destaque', 'jogador'].filter(k => P[k]).map(k => linhaPalpite(a, k, P[k])).join('');
    return '<div class="palpites"><h3>Melhores apostas deste jogo</h3>' + (P.nada ? '<p class="nada">' + esc(P.nada) + '</p>' : '') + (itens ? '<ul>' + itens + '</ul>' : '') + '</div>';
  }

  function cartaoAnalise(a) {
    const m = a.m, fam = S.familia[m.id] || 'times', principais = a.linhas.filter(l => l.principal && !(l.mk.t === 'tot' && trivial(l, 0.92)));
    const grupo = OUTRAS.find(x => x[0] === fam) || OUTRAS[0], outras = a.linhas.filter(l => !l.principal && grupo[2](l) && !trivial(l, 0.85));
    const ref = a.ref && a.ref.x12 ? a.ref.x12.p : null, mod = ['h', 'd', 'a'].map(s => (a.linhas.find(l => l.chave === '1x2:' + s) || {}).pModelo);
    const abas = OUTRAS.map(([id, nome]) => '<button class="fam' + (fam === id ? ' ativa' : '') + '" data-fam="' + m.id + '|' + id + '">' + nome + '</button>').join('');
    const res = a.resumo || {}, escal = (res.escalacoes || []).filter(e => e.titulares.length >= 11), desf = res.desfalques || [];
    const h2h = a.h2h.map(j => '<li>' + dia(j.date) + ' · ' + esc(j.hn) + ' <b>' + (j.hg ?? j.fh) + '–' + (j.ag ?? j.fa) + '</b> ' + esc(j.an) + ' <small>' + esc(nomeComp(j.comp)) + '</small></li>').join('');
    const dest = blocoPalpites(a);
    return '<article class="cartao" id="a-' + m.id + '"><header><div class="topo-cartao"><p class="sobre">' + esc(nomeComp(m.comp)) + ' · ' + diaHora(m.date) + (res.estadio ? ' · ' + esc(res.estadio) : '') + (res.arbitro ? ' · árbitro ' + esc(res.arbitro) : '') + '</p><div class="exportar"><button class="link" data-copiar="' + m.id + '">Copiar</button><button class="link" data-baixar="' + m.id + '">Baixar</button></div></div>'
      + '<h2>' + esc(m.hn) + ' <span>×</span> ' + esc(m.an) + '</h2>' + (a.iniciado ? '<p class="aviso">Partida já iniciada ou encerrada: sem registro pré-jogo.' + (m.done ? ' Placar: ' + m.fh + '–' + m.fa + '.' : '') + '</p>' : '') + '</header>'
      + '<div class="resumo"><div><span class="sobre">Modelo · 1 X 2</span>' + barra3(mod) + '<b>' + mod.map(v => pct(v)).join(' · ') + '</b></div><div><span class="sobre">Mercado · 1 X 2</span>' + (ref ? barra3(ref, 'mercado') + '<b>' + ref.map(v => pct(v)).join(' · ') + '</b>' : '<b>sem odd</b>') + '</div>'
      + '<div><span class="sobre">Gols esperados</span><b>' + num(a.lh) + ' × ' + num(a.la) + ' <small>modelo</small></b>' + (a.ref ? '<small>mercado ' + num(a.ref.lh) + ' × ' + num(a.ref.la) + '</small>' : '') + '</div><div><span class="sobre">Placares mais prováveis</span><b>' + a.placares.slice(0, 4).map(p => '<span class="nw">' + p[0] + '–' + p[1] + ' <small>' + pct(p[2]) + '</small></span>').join(' · ') + '</b></div></div>'
      + '<div class="leitura"><h3>Leitura</h3><ul>' + leitura(a).map(t => '<li>' + t + '</li>').join('') + '</ul>' + (a.alertas.length ? '<ul class="alertas">' + a.alertas.map(x => '<li class="' + x.tipo + '">' + esc(x.texto) + '</li>').join('') + '</ul>' : '') + '</div>'
      + dest
      + '<h3>Linhas principais</h3><div class="tabela"><table>' + CAB + '<tbody>' + principais.map(l => linhaTabela(a, l)).join('') + '</tbody></table></div>'
      + '<p class="nota">Odd sugerida: média das casas que cotam a linha; sem cotação, o preço justo (do mercado, ou do modelo) com a margem típica das casas. Valor = chance do modelo × odd − 1, só quando a odd é cotada por uma casa (com odd estimada, o valor só repetiria a diferença entre modelo e mercado). Linhas de gols quase certas (acima de 92%) ficam fora.</p>'
      + '<details class="contexto"><summary>Outras linhas</summary><div class="fams">' + abas + '</div><div class="tabela"><table>' + CAB + '<tbody>' + (outras.length ? outras.map(l => linhaTabela(a, l)).join('') : '<tr><td colspan="7" class="nota">Sem linhas neste grupo.</td></tr>') + '</tbody></table></div>'
      + '<p class="nota">' + (fam === 'escanteios' && a.escanteios ? 'Média esperada de escanteios: ' + num(a.escanteios.lh, 1) + ' × ' + num(a.escanteios.la, 1) + '. ' : '') + (fam === 'cartoes' && a.cartoes ? 'Média esperada de cartões: ' + num(a.cartoes.lh, 1) + ' × ' + num(a.cartoes.la, 1) + ' (sem o efeito do árbitro). ' : '') + 'Escanteios e cartões não têm odd na fonte; só sobem para "Fora do normal" quando a chance fica bem acima da média da competição.</p></details>'
      + blocoJogadores(a)
      + '<details class="contexto"><summary>Calendário, forma e confrontos</summary><div class="dois">' + blocoCalendario(a, 'casa') + blocoCalendario(a, 'fora') + '</div>'
      + '<h4>Confrontos diretos (todas as competições, desde 2024)</h4>' + (h2h ? '<ul class="lista">' + h2h + '</ul>' : '<p class="nota">Sem confrontos na rede.</p>')
      + (escal.length ? '<h4>Escalações confirmadas</h4>' + escal.map(e => '<p class="nota"><b>' + esc(e.time === m.h ? m.hn : m.an) + '</b> ' + esc(e.formacao) + ': ' + esc(e.titulares.join(', ')) + '</p>').join('') : '')
      + (desf.length ? '<h4>Desfalques informados</h4><ul class="lista">' + desf.slice(0, 16).map(d => '<li>' + esc(d.time === m.h ? m.hn : m.an) + ' · ' + esc(d.jogador) + ' <small>' + esc(d.status) + '</small></li>').join('') + '</ul>' : '') + '</details></article>';
  }
  function renderAnalise() {
    const el = $('#analise'); if (!el || S.aba !== 'analise') return;
    const lista = [...S.analises.values()].sort((x, y) => Date.parse(x.m.date) - Date.parse(y.m.date));
    if (!lista.length) { el.innerHTML = '<div class="vazio"><h2>Nenhuma partida analisada</h2><p>No Radar, marque as partidas e toque em Analisar selecionados, ou clique direto numa partida.</p><button class="pri" data-ir="radar">Abrir o Radar</button></div>'; return; }
    const nav = lista.map(a => '<a href="#a-' + a.m.id + '" class="mini">' + hora(a.m.date) + ' · ' + esc(a.m.hn) + ' × ' + esc(a.m.an) + '</a>').join('');
    el.innerHTML = '<div class="cabeca"><div><p class="sobre">' + lista.length + ' PARTIDA(S)</p><h1>Análise</h1></div><div class="acoes"><button class="sec" id="copiar-todas">Copiar todas</button><button class="sec" id="baixar-todas">Baixar todas</button><button class="sec" id="limpar-analises">Limpar</button></div></div><nav class="indice">' + nav + '</nav>' + lista.map(cartaoAnalise).join('');
  }

  /* ---------- Exportar análise ---------- */
  const p2 = v => Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
  function dadosAnalise(a) {
    const m = a.m;
    return { partida: { id: m.id, competicao: nomeComp(m.comp), inicio: m.date, casa: m.hn, fora: m.an, placarFinal: m.done ? [m.fh, m.fa] : null },
      modelo: { golsEsperados: [p2(a.lh), p2(a.la)], x12: ['h', 'd', 'a'].map(s => p2((a.linhas.find(l => l.chave === '1x2:' + s) || {}).pModelo)) },
      mercado: a.ref ? { fonte: a.ref.fonte, golsEsperados: [p2(a.ref.lh), p2(a.ref.la)], x12: a.ref.x12 ? a.ref.x12.p.map(p2) : null } : null,
      linhas: a.linhas.map(l => ({ linha: l.rotulo, principal: l.principal, modelo: p2(l.pModelo), faixa90: l.faixa ? l.faixa.map(p2) : null, mercado: p2(l.pMercado), normalDaCompeticao: p2(l.pTipico), oddSugerida: l.odd, tipoOdd: l.oddTipo, casas: l.oddCasas, oddJusta: p2(l.justa), valorModelo: p2(l.ev) })),
      foraDoNormal: a.destaques.map(l => l.rotulo), melhoresApostas: a.palpites ? { nada: a.palpites.nada, principal: a.palpites.principal && { linha: a.palpites.principal.rotulo, odd: a.palpites.principal.odd, chance: p2(a.palpites.chance(a.palpites.principal)) }, oddMaior: a.palpites.oddMaior && { linha: a.palpites.oddMaior.rotulo, odd: a.palpites.oddMaior.odd, chance: p2(a.palpites.chance(a.palpites.oddMaior)) }, foraDoNormal: a.palpites.destaque && { linha: a.palpites.destaque.rotulo, odd: a.palpites.destaque.odd }, jogador: a.palpites.jogador && { nome: a.palpites.jogador.nome, odd: a.palpites.jogador.odd, chance: p2(a.palpites.jogador.p) } } : null, quemPodeMarcar: { casa: a.jogadores.casa.map(j => ({ nome: j.nome, chance: p2(j.p), odd: j.odd })), fora: a.jogadores.fora.map(j => ({ nome: j.nome, chance: p2(j.p), odd: j.odd })), casaDasOdds: a.jogadores.casaOdds },
      placaresMaisProvaveis: a.placares.map(p => ({ placar: p[0] + '-' + p[1], chance: p2(p[2]) })), alertas: a.alertas.map(x => x.texto), geradoEm: a.geradoEm, versao: 'Ponto Comum v3' };
  }
  function textoAnalise(a) {
    const m = a.m, x12 = ['h', 'd', 'a'].map(s => a.linhas.find(l => l.chave === '1x2:' + s)), out = [];
    out.push('⚽ ' + m.hn + ' × ' + m.an + ' — ' + nomeComp(m.comp) + ' · ' + diaHora(m.date));
    out.push('Modelo 1X2: ' + x12.map(l => pct(l && l.pModelo)).join(' · ') + (a.ref && a.ref.x12 ? ' | mercado ' + a.ref.x12.p.map(v => pct(v)).join(' · ') : ''));
    out.push('Gols esperados: ' + num(a.lh) + ' × ' + num(a.la) + (a.ref ? ' (mercado ' + num(a.ref.lh) + ' × ' + num(a.ref.la) + ')' : ''));
    out.push('', 'Linha · modelo · mercado · odd sugerida');
    for (const l of a.linhas.filter(l => l.principal && !(l.mk.t === 'tot' && trivial(l, 0.92)))) out.push('• ' + l.rotulo + ': ' + pct(l.pModelo) + ' · ' + pct(l.pMercado) + ' · ' + num(l.odd) + (l.oddTipo !== 'cotada' ? ' (estimada)' : '') + (l.concorda === false ? ' ⚠ diverge' : ''));
    const P = a.palpites; if (P) { out.push('', 'Melhores apostas:'); if (P.nada) out.push('• ' + P.nada); if (P.valor) out.push('• Valor: ' + P.valor.rotulo + ' a ' + num(P.valor.oddOutra) + ' na ' + P.valor.casaOutra + ' (preço justo da Pinnacle ' + num(1 / P.valor.pPinnacle) + ')'); for (const k of ['principal', 'oddMaior', 'destaque']) if (P[k]) out.push('• ' + TIPO_PALPITE[k] + ': ' + P[k].rotulo + ' a ' + num(P[k].odd) + ' (chance ' + pct(P.chance(P[k])) + ')'); if (P.jogador) out.push('• Jogador: ' + P.jogador.nome + ' marca a ' + num(P.jogador.odd) + ' (modelo ' + pct(P.jogador.p) + ')'); }
    const f = fortes(a); out.push('', f.length ? 'Nos seus mercados (55–88%): ' + f.map(l => l.rotulo + ' ' + pct(l.pModelo) + ' a ' + num(l.odd)).join('; ') : 'Nada bom neste jogo pelos critérios do hub.');
    const jg = [...a.jogadores.casa, ...a.jogadores.fora].filter(j => j.p).sort((x, y) => y.p - x.p).slice(0, 4);
    if (jg.length) out.push('Quem pode marcar: ' + jg.map(j => j.nome + ' ' + pct(j.p) + (j.odd ? ' (odd ' + num(j.odd) + ')' : '')).join('; '));
    if (a.destaques.length) out.push('Fora do normal: ' + a.destaques.map(l => l.rotulo + ' ' + pct(l.pModelo) + ' (normal ' + pct(l.pTipico) + ')').join('; '));
    out.push('Placares: ' + a.placares.slice(0, 4).map(p => p[0] + '-' + p[1] + ' ' + pct(p[2])).join(', '));
    if (a.alertas.length) out.push('', ...a.alertas.map(x => '! ' + x.texto));
    return out.join('\n');
  }

  /* ---------- Palpites do dia ---------- */
  const doDiaParaPalpites = () => S.agenda.filter(m => S.comps.has(m.comp) && filtraGrandes(m) && !m.void);
  async function carregarPalpites() {
    if (!S.F) return; const dia = S.dia, jogos = doDiaParaPalpites(), faltam = jogos.filter(m => !S.analises.has(m.id) && !m.done && m.state !== 'in');
    if (S.palpitesDia && S.palpitesDia.dia === dia && !faltam.length) return;
    S.palpitesDia = { dia, carregando: faltam.length }; renderPalpites();
    if (faltam.length) { const n = await analisarLista(faltam); if (n) toast(n + ' previsões registradas no diário antes do jogo.'); }
    S.palpitesDia = { dia, carregando: 0 }; renderPalpites();
  }
  function textoPalpites(lista) {
    const out = ['Palpites Ponto Comum · ' + S.dia.split('-').reverse().join('/')];
    for (const a of lista) { const P = a.palpites; out.push('', hora(a.m.date) + ' ' + a.m.hn + ' × ' + a.m.an + ' (' + nomeComp(a.m.comp) + ')');
      if (P.nada) out.push('  ' + P.nada); if (P.valor) out.push('  Valor: ' + P.valor.rotulo + ' @ ' + num(P.valor.oddOutra) + ' na ' + P.valor.casaOutra + ' (justo Pinnacle ' + num(1 / P.valor.pPinnacle) + ')'); for (const k of ['principal', 'oddMaior', 'destaque']) if (P[k]) out.push('  ' + TIPO_PALPITE[k] + ': ' + P[k].rotulo + ' @ ' + num(P[k].odd) + ' (' + pct(P.chance(P[k])) + ')'); if (P.jogador) out.push('  Jogador: ' + P.jogador.nome + ' marca @ ' + num(P.jogador.odd) + ' (' + pct(P.jogador.p) + ')'); }
    return out.join('\n');
  }
  function renderPalpites() {
    const el = $('#palpites'); if (!el || S.aba !== 'palpites') return;
    const jogos = doDiaParaPalpites(), lista = jogos.map(m => S.analises.get(m.id)).filter(Boolean).sort((x, y) => Date.parse(x.m.date) - Date.parse(y.m.date));
    const carregando = !S.F ? 'O modelo ainda está sendo ajustado…' : S.palpitesDia && S.palpitesDia.carregando ? 'Analisando ' + S.palpitesDia.carregando + ' partida(s): odds, elencos e contexto…' : '';
    const comPalpite = lista.filter(a => a.palpites && a.palpites.principal).length;
    const cartao = a => { const m = a.m, P = a.palpites; return '<article class="palpite-jogo' + (a.iniciado ? ' passado' : '') + '"><header><span class="hora">' + (m.done ? m.fh + '–' + m.fa : hora(m.date)) + '</span><div><b>' + esc(m.hn) + ' × ' + esc(m.an) + '</b><small>' + esc(nomeComp(m.comp)) + (a.iniciado ? ' · já começou' : '') + '</small></div><button class="link" data-analisar="' + m.id + '">análise</button></header>' + blocoPalpites(a).replace('<h3>Melhores apostas deste jogo</h3>', '') + '</article>'; };
    el.innerHTML = '<div class="cabeca"><div><p class="sobre">MELHORES APOSTAS POR JOGO · ' + esc(S.dia.split('-').reverse().join('/')) + '</p><h1>Palpites</h1></div><div class="acoes">' + (lista.length ? '<button class="sec" id="copiar-palpites">Copiar palpites</button>' : '') + '</div></div>'
      + '<p class="nota">' + (carregando ? '<span class="pulso"></span> ' + carregando : lista.length ? comPalpite + ' de ' + lista.length + ' jogos com aposta principal. ' : '') + 'Jogos do radar desta data (com o filtro de grandes). Sem múltiplas: cada jogo tem a sua melhor aposta.</p>'
      + (lista.length ? lista.map(cartao).join('') : !carregando ? '<div class="vazio"><h2>Sem jogos</h2><p>Nenhuma partida do radar nesta data. Escolha outra data no topo.</p></div>' : '')
      + '<details class="filtro"><summary>Como os palpites são escolhidos (e o que deu nos testes)</summary><p class="nota">Backtest de 18 mil jogos de 8 ligas (football-data.co.uk, 2020–2026), com o modelo prevendo semana a semana só com jogos anteriores. Regras escolhidas até 2023/24 e conferidas de 2024/25 em diante, nas odds da Bet365 de antes da rodada. Retorno = lucro ÷ total apostado.</p><ul class="metodo"><li><b>Valor:</b> a Bet365 ou a DraftKings pagam acima do preço justo da Pinnacle (a casa mais afiada, sem a margem), com odd de 2,60 a 13. Treino +12,0%, teste +5,9%, acerto de 27,5% com odd média 4,21: erra muito, mas quando acerta paga mais do que o risco. Atenção: por temporada deu +0, +11, +5, +33, +22 e −29% (2025/26), então a vantagem oscila e pode estar diminuindo. Só aparece quando há odds da Pinnacle para o jogo (ligas europeias, antes da rodada).</li><li><b>Principal:</b> a linha de maior chance nos seus mercados com odd de pelo menos 1,35 e modelo e mercado a até 5 p.p. Acerta cerca de 61%, mas perde 4,3% na Bet365: é a margem da casa. Pegando a melhor odd do mercado, a perda cai para 1,4%.</li><li><b>Odd maior:</b> outro mercado com odd de 1,70 a 2,60. Teste −3,3% na Bet365, −1,4% com a melhor odd.</li><li><b>Odds altas sem valor perdem mais:</b> todas as apostas de odd 8 a 13 renderam −38% no teste; de 13 para cima, −46%. As casas cobram margem maior nas zebras.</li><li><b>Fora do normal e jogador:</b> sem histórico de odds suficiente; o robô está medindo.</li><li>Use a melhor odd que encontrar: em todas as faixas, foi o que mais reduziu a perda.</li></ul></details>';
  }

  /* ---------- Bilhete ---------- */
  const tipoOddPerna = p => p.oddManual ? 'sua odd' : p.oddTipo === 'cotada' ? 'média das casas' : 'estimada';
  function renderBilhete() {
    const el = $('#bilhete'); if (!el || S.aba !== 'bilhete') return;
    const ps = B.lista(), av = B.avaliar(ps, S.analises);
    const pernas = ps.map(p => '<li><div><b>' + esc(p.rotulo) + '</b><small>' + esc(p.jogo) + ' · ' + diaHora(p.inicio) + '</small><small>modelo ' + pct(p.pModelo ?? p.p, 1) + (Number.isFinite(p.pMercado) ? ' · mercado ' + pct(p.pMercado, 1) : '') + '</small></div>'
      + '<label class="odd">odd <small>' + tipoOddPerna(p) + '</small><input type="number" step="0.01" min="1.01" inputmode="decimal" id="odd-' + esc(p.id) + '" data-odd="' + esc(p.id) + '" value="' + (B.oddDe(p) ? B.oddDe(p).toFixed(2) : '') + '"></label><button class="rem" data-rem="' + esc(p.id) + '" aria-label="Remover">×</button></li>').join('');
    el.innerHTML = '<div class="cabeca"><div><p class="sobre">O QUE VOCÊ APOSTOU</p><h1>Bilhete</h1></div><div class="acoes">' + (ps.length ? '<button class="sec" id="limpar-bilhete">Limpar</button>' : '') + '</div></div>'
      + (ps.length ? '<div class="bilhete"><ul class="pernas">' + pernas + '</ul><div class="totais"><div><span class="sobre">Odd ' + (ps.length > 1 ? 'combinada' : '') + '</span><b>' + (av.odd ? num(av.odd) : '—') + '</b><small>' + (av.oddEstimada ? 'com bloco do mesmo jogo estimado' : 'justa pelo modelo: ' + num(av.justa)) + '</small></div><div><span class="sobre">Chance (modelo)</span><b>' + pct(av.pModelo, 1) + '</b><small>mercado: ' + pct(av.pMercado, 1) + '</small></div><div><span class="sobre">Valor esperado</span><b class="' + (av.ev === null ? '' : av.ev > 0 ? 'pos' : 'neg') + '">' + sinal(av.ev) + '</b><small>modelo · mercado ' + sinal(av.evMercado) + '</small></div></div>'
        + (av.avisos.length ? '<ul class="avisos">' + av.avisos.map(x => '<li class="' + x.nivel + '">' + esc(x.texto) + '</li>').join('') + '</ul>' : '')
        + (ps.length > 2 ? '<p class="nota">Cada perna a mais multiplica também a margem da casa: numa múltipla de ' + ps.length + ' pernas, o retorno esperado cai bem mais que numa aposta simples.</p>' : '')
        + '<div class="salvar"><label>valor <input type="number" id="valor-aposta" min="0" step="0.5" inputmode="decimal" placeholder="R$"></label><label>odd que você pegou <input type="number" id="odd-pega" min="1.01" step="0.01" inputmode="decimal" placeholder="' + (av.odd ? num(av.odd).replace(',', '.') : '') + '"></label><button class="pri" id="registrar-aposta">Registrar aposta</button><button class="sec" id="acompanhar">Só acompanhar</button></div></div>'
        : '<div class="vazio"><h2>Bilhete vazio</h2><p>Nos Palpites ou na Análise, toque em + ao lado de uma aposta para registrar o que você jogou de fato (simples ou múltipla). A odd vem preenchida; troque pela da sua casa.</p></div>');
  }

  /* ---------- Diário ---------- */
  /* Histórico do hub: previsões e bilhetes que o robô registrou antes dos jogos (o mesmo em qualquer aparelho). */
  const FAM_NOME = { resultado: 'Resultado (1X2, dupla, handicap)', gols: 'Gols (totais, ambas)', tempos: 'Tempos e 1º gol', escanteios: 'Escanteios', cartoes: 'Cartões' };
  function blocoHistorico() {
    const r = S.revisao; if (!r || !r.jogos) return r === null ? '' : '<h3>Histórico do hub</h3><p class="nota">O robô começou a registrar as previsões antes dos jogos; o histórico aparece quando os primeiros jogos terminarem.</p>';
    const lt = r.leitura || {}, mv = r.movimentoDoMercado || {};
    const pal = ['valor', 'principal', 'oddMaior', 'destaque', 'jogador'].filter(k => r.palpites && r.palpites[k] && r.palpites[k].n).map(k => { const x = r.palpites[k]; return '<tr><td>' + TIPO_PALPITE[k] + '</td><td class="num">' + x.acertos + '/' + x.n + '</td><td class="num">' + pct(x.acertos / x.n) + '<small>previsto ' + pct(x.previsto) + '</small></td><td class="num">' + (x.oddMedia ? num(x.oddMedia) : '—') + '</td><td class="num ' + (x.retorno > 0 ? 'pos' : x.retorno < 0 ? 'neg' : '') + '">' + (x.retorno !== null && x.retorno !== undefined ? sinal(x.retorno) : '—') + '</td></tr>'; }).join('');
    const fams = Object.entries(r.porFamilia || {}).map(([f, x]) => '<tr><td>' + (FAM_NOME[f] || f) + '</td><td class="num">' + x.n + '</td><td class="num">' + num(x.llModeloComMercado ?? x.llModelo, 3) + '</td><td class="num">' + (x.llMercado !== null ? '<b>' + num(x.llMercado, 3) + '</b>' : '—') + '</td></tr>').join('');
    const dias = (r.dias || []).slice(0, 14).map(d => {
      const feitos = d.jogos.filter(j => !j.pendente), marca = ok => ok === 1 ? '<span class="pos">✓</span> ' : ok === 0 ? '<span class="neg">✗</span> ' : '· ';
      const jogos = feitos.map(j => '<li><b>' + esc(j.jogo) + '</b> ' + j.placar.join('–') + ' <small>' + esc(nomeComp(j.comp)) + '</small><br>' + (j.palpites && j.palpites.length ? j.palpites.map(x => marca(x.ok) + '<small>' + TIPO_PALPITE[x.tipo] + ':</small> ' + esc(x.rotulo) + (x.odd ? ' <small class="nw">a ' + num(x.odd) + '</small>' : '')).join('<br>') : j.nada ? '<small>nada bom (sem palpite)</small>' : j.leitura && j.leitura.length ? j.leitura.map(l => marca(l.ok) + esc(l.rotulo) + ' <small class="nw">' + pct(l.p) + '</small>').join(' · ') : '<small>sem palpite registrado</small>') + '</li>').join('');
      return '<details class="contexto"><summary>' + d.dia.split('-').reverse().join('/') + ' <small>' + feitos.length + ' jogo(s) apurado(s)</small></summary>' + (jogos ? '<ul class="lista">' + jogos + '</ul>' : '<p class="nota">Jogos ainda não terminaram.</p>') + '</details>';
    }).join('');
    return '<h3>Histórico do hub</h3><p class="nota">Registrado pelo robô do site antes de cada jogo (o mesmo em qualquer aparelho) e conferido depois. Atualizado às ' + diaHora(r.geradoEm) + '.</p>'
      + '<div class="resumo"><div><span class="sobre">Jogos apurados</span><b>' + r.jogos + '</b></div><div><span class="sobre">Palpite principal</span><b>' + (r.palpites && r.palpites.principal && r.palpites.principal.n ? r.palpites.principal.acertos + '/' + r.palpites.principal.n : '—') + '</b><small>' + (r.palpites && r.palpites.principal && r.palpites.principal.n ? 'esperado ' + num(r.palpites.principal.previsto * r.palpites.principal.n, 1) + ' pela chance' : 'aparece quando os jogos terminarem') + '</small></div>'
      + '<div><span class="sobre">Mercado andou para o lado do modelo</span><b>' + (mv.n ? pct(mv.aFavorDoModelo / mv.n) : '—') + '</b><small>' + (mv.n ? mv.n + ' linhas de 1X2 em que os dois discordavam 3+ p.p. · do registro ao fechamento' : 'aparece com as odds de fechamento') + '</small></div></div>'
      + (pal ? '<div class="tabela"><table><thead><tr><th>Palpites do robô</th><th class="num">Acertos</th><th class="num">Taxa</th><th class="num">Odd média</th><th class="num">Retorno</th></tr></thead><tbody>' + pal + '</tbody></table></div><p class="nota">Retorno de apostar 1 unidade em cada palpite, na odd registrada antes do jogo. Com poucos jogos, sorte pesa mais que método.</p>' : '')
      + (fams ? '<div class="tabela"><table><thead><tr><th>Mercado</th><th class="num">Linhas</th><th class="num">Erro do modelo ↓</th><th class="num">Erro do mercado ↓</th></tr></thead><tbody>' + fams + '</tbody></table></div><p class="nota">Log loss nas linhas registradas que têm preço de mercado (menor é melhor). Escanteios e cartões não têm mercado na fonte.</p>' : '')
      + dias;
  }
  async function renderDiario() {
    const el = $('#diario'); if (!el || S.aba !== 'diario') return;
    const lista = await D.todos(), mt = D.metricas(lista), rev = D.revisao(lista), b = mt.bilhetes;
    const fam = { resultado: 'Resultado', gols: 'Gols', tempos: 'Tempos', escanteios: 'Escanteios', cartoes: 'Cartões' };
    const linhasFam = Object.entries(mt.porFamilia).filter(([, g]) => g).map(([f, g]) => '<tr><td>' + fam[f] + '</td><td class="num">' + g.n + '</td><td class="num">' + pct(g.previsto, 1) + '</td><td class="num">' + pct(g.aconteceu, 1) + '</td><td class="num">' + num(g.logLoss, 3) + '</td><td class="num">' + (g.logLossMercado !== null ? num(g.logLossMercado, 3) + '<small>' + g.nMercado + ' linhas</small>' : '—') + '</td></tr>').join('');
    const faixas = mt.faixas.map(f => '<div class="faixa"><span>' + Math.round(f.de * 100) + '–' + Math.round(f.ate * 100) + '%</span><i style="width:' + (f.aconteceu * 100).toFixed(0) + '%"></i><b>' + pct(f.aconteceu) + '</b><small>' + f.n + '</small></div>').join('');
    const niveis = Object.entries(b.porNivel).map(([k, x]) => '<tr><td>' + (NIVEL_NOME[k] || k) + '</td><td class="num">' + x.apostas + '</td><td class="num">' + x.ganhas + '/' + x.apuradas + '</td><td class="num">' + reais(x.investido) + '</td><td class="num ' + (x.lucro > 0 ? 'pos' : x.lucro < 0 ? 'neg' : '') + '">' + reais(x.lucro) + '</td><td class="num">' + (x.investido ? sinal(x.lucro / x.investido) : '—') + '</td></tr>').join('');
    const bilhetes = lista.filter(r => r.tipo === 'bilhete').slice(0, 60).map(r => '<tr><td>' + diaHora(r.inicio) + '</td><td>' + (r.modo === 'aposta' ? '<b>' + (NIVEL_NOME[r.nivel] || 'Aposta') + '</b>' : 'Acompanhado') + ' · ' + r.pernas.length + ' perna(s)<small>' + r.pernas.map(p => (p.resultado === 1 ? '✓ ' : p.resultado === 0 ? '✗ ' : '') + esc(p.rotulo) + ' (' + esc(p.jogo) + ')').join('<br>') + '</small></td>'
      + '<td class="num">' + num(r.odd) + '<small>chance ' + pct(r.pModelo, 1) + '</small></td><td class="num">' + (r.valor ? reais(r.valor) : '—') + '</td><td>' + (r.apurado ? (r.resultado ? '<b class="pos">ganhou</b>' : '<b class="neg">perdeu</b>') + (Number.isFinite(r.lucro) ? '<small>' + reais(r.lucro) + '</small>' : '') : 'pendente') + '</td><td><button class="rem" data-del="' + esc(r.id) + '" aria-label="Apagar registro">×</button></td></tr>').join('');
    const revisao = rev.map(g => '<tr><td>' + dia(g.inicio) + '<small>' + esc(nomeComp(g.comp)) + '</small></td><td><b>' + esc(g.jogo) + '</b> ' + (g.placar ? g.placar.join('–') : '') + '</td><td>' + (g.favorito ? (g.favorito.aconteceu ? '✓ ' : '✗ ') + esc(g.favorito.rotulo) + ' <small>modelo ' + pct(g.favorito.p) + (Number.isFinite(g.favorito.pMercado) ? ' · mercado ' + pct(g.favorito.pMercado) : '') + '</small>' : '—') + '</td>'
      + '<td>' + (g.ditas.length ? g.ditas.map(r => (r.resultado ? '<span class="pos">✓</span> ' : '<span class="neg">✗</span> ') + esc(r.rotulo) + ' <small class="nw">' + pct(r.pModelo ?? r.p) + '</small>').join('<br>') : '<small>nada entre 55% e 88%</small>') + '</td><td class="num">' + (g.ditas.length ? g.acertos + '/' + g.ditas.length : '—') + '</td></tr>').join('');
    const totDitas = rev.reduce((s, g) => s + g.ditas.length, 0), totAc = rev.reduce((s, g) => s + g.acertos, 0), espDitas = rev.reduce((s, g) => s + g.ditas.reduce((t, r) => t + (r.pModelo ?? r.p), 0), 0);
    el.innerHTML = '<div class="cabeca"><div><p class="sobre">PREVISÃO → RESULTADO → APRENDIZADO</p><h1>Diário</h1></div><div class="acoes"><button class="pri" id="apurar">Apurar resultados</button><button class="sec" id="exportar">Exportar</button><label class="sec arquivo">Importar<input type="file" id="importar" accept="application/json,.json"></label></div></div>'
      + '<div class="resumo"><div><span class="sobre">Apostas reais</span><b class="' + (b.lucro > 0 ? 'pos' : b.lucro < 0 ? 'neg' : '') + '">' + reais(b.lucro) + '</b><small>' + b.apostas + ' apostas · ' + b.ganhas + ' ganhas de ' + b.apuradas + ' apuradas · ' + b.pendentes + ' pendentes</small></div><div><span class="sobre">Retorno</span><b>' + (b.roi !== null ? sinal(b.roi) : '—') + '</b><small>investido ' + reais(b.investido) + '</small></div>'
      + '<div><span class="sobre">O hub acertou</span><b>' + (totDitas ? totAc + '/' + totDitas : '—') + '</b><small>' + (totDitas ? 'linhas ditas na leitura · esperado ' + num(espDitas, 1) : 'aparece após apurar') + '</small></div><div><span class="sobre">CLV médio</span><b>' + (mt.clv ? sinal(mt.clv.medio) : '—') + '</b><small>' + (mt.clv ? mt.clv.n + ' linhas · ' + mt.clv.positivos + ' positivas' : 'odd da DraftKings na análise ÷ fechamento') + '</small></div></div>'
      + (niveis ? '<h3>Apostas por tipo</h3><div class="tabela"><table><thead><tr><th>Tipo</th><th class="num">Apostas</th><th class="num">Ganhas</th><th class="num">Investido</th><th class="num">Lucro</th><th class="num">Retorno</th></tr></thead><tbody>' + niveis + '</tbody></table></div>' : '')
      + '<h3>Bilhetes e apostas</h3>' + (bilhetes ? '<div class="tabela"><table><thead><tr><th>Início</th><th>Bilhete</th><th class="num">Odd</th><th class="num">Valor</th><th>Resultado</th><th></th></tr></thead><tbody>' + bilhetes + '</tbody></table></div>' : '<p class="nota">Nenhum bilhete salvo. No Bilhete, informe valor e odd e toque em Registrar aposta.</p>')
      + blocoHistorico()
      + '<h3>Revisão das suas análises neste aparelho</h3>' + (revisao ? '<div class="tabela"><table><thead><tr><th>Dia</th><th>Jogo</th><th>Favorito do modelo</th><th>Linhas da leitura (55–88%)</th><th class="num">Acertos</th></tr></thead><tbody>' + revisao + '</tbody></table></div><p class="nota">Se o hub estiver bem calibrado, os acertos ficam perto do esperado (a soma das chances). Muito acima ou muito abaixo, por muitas semanas, indica erro.</p>' : '<p class="nota">Aparece depois de apurar jogos que você analisou antes do início.</p>')
      + (linhasFam ? '<h3>Calibração das previsões registradas</h3><div class="tabela"><table><thead><tr><th>Mercado</th><th class="num">Linhas</th><th class="num">Chance média do modelo</th><th class="num">Aconteceu</th><th class="num">Log loss modelo ↓</th><th class="num">Log loss mercado ↓</th></tr></thead><tbody>' + linhasFam + '</tbody></table></div><h3>Os 70% acontecem 70% das vezes?</h3><div class="faixas">' + faixas + '</div><p class="nota">Linhas do mesmo jogo são correlacionadas; avalie com centenas de jogos, não dezenas.</p>' : '');
  }

  /* ---------- Validação ---------- */
  function tabelaMetricas(linhas) { return '<div class="tabela"><table><thead><tr><th></th><th class="num">Jogos</th><th class="num">Log loss 1X2 ↓</th><th class="num">Log loss over 2,5 ↓</th><th class="num">Log loss ambas ↓</th></tr></thead><tbody>' + linhas.map(([n, m]) => m ? '<tr><td>' + n + '</td><td class="num">' + (m.n ?? '—') + '</td><td class="num">' + num(m.logLoss1x2, 4) + '</td><td class="num">' + num(m.logLossOver25, 4) + '</td><td class="num">' + num(m.logLossAmbas, 4) + '</td></tr>' : '').join('') + '</tbody></table></div>'; }
  function tabelaRegras(rg) {
    const linha = (x, w) => '<tr><td>' + esc(x.nome) + '</td><td>' + w + '</td><td class="num">' + x.n + '</td><td class="num">' + (x.n ? pct(x.acertos / x.n) : '—') + '</td><td class="num">' + num(x.oddMedia) + '</td><td class="num ' + (x.roi > 0 ? 'pos' : 'neg') + '">' + sinal(x.roi) + '</td></tr>';
    return '<div class="tabela"><table><thead><tr><th>Regra</th><th>Odd</th><th class="num">Apostas</th><th class="num">Acerto</th><th class="num">Odd média</th><th class="num">Retorno</th></tr></thead><tbody>' + rg.abertura.map(x => linha(x, 'abertura')).join('') + rg.fechamento.map(x => linha(x, 'fechamento')).join('') + '</tbody></table></div>';
  }
  /* Backtest financeiro com a base da football-data.co.uk (várias temporadas e casas). */
  function blocoBacktest() {
    const b = S.backtest; if (!b) return '';
    const q = b.qualidade, f = x => x && x.n ? x : null, ret = x => x && x.n ? '<span class="' + (x.retorno > 0 ? 'pos' : 'neg') + '">' + sinal(x.retorno) + '</span>' : '—';
    const faixas = b.faixas.map(x => { const t = x.tudo.teste, m = x.melhorOdd.teste; return '<tr><td class="nw">' + num(x.de) + '–' + (x.ate >= 100 ? '…' : num(x.ate)) + '</td><td class="num">' + t.n.toLocaleString('pt-BR') + '</td><td class="num">' + pct(t.acerto, 1) + '</td><td class="num">' + pct(t.chanceImplicita, 1) + '</td><td class="num">' + ret(t) + '</td><td class="num">' + ret(m) + '</td><td class="num">' + t.piorSequencia + '</td></tr>'; }).join('');
    const ra = b.regraAtual, linhaRA = (nome, x) => '<tr><td>' + nome + '</td><td class="num">' + x.teste.n.toLocaleString('pt-BR') + '</td><td class="num">' + pct(x.teste.acerto, 1) + '</td><td class="num">' + num(x.teste.oddMedia) + '</td><td class="num">' + ret(x.teste) + '</td><td class="num">' + ret(x.testeFechamento) + '</td><td class="num">' + ret(x.testeMelhorOdd) + '</td></tr>';
    const vars = b.variantes ? Object.entries(b.variantes).map(([k, v]) => '<tr><td>' + esc(({ semMercado: 'Sem odds de fechamento passadas', xg50: 'Com xG (50%)', xg30: 'Com xG (30%)', xg50semMercado: 'Com xG, sem odds passadas', semChutes: 'Sem chutes no alvo' })[k] || k) + '</td><td class="num">' + num(v.teste.logLoss1x2.modelo, 4) + '</td><td class="num">' + num(v.teste.logLossOver25.modelo, 4) + '</td></tr>').join('') : '';
    return '<h3>Backtest financeiro: ' + b.jogos.toLocaleString('pt-BR') + ' jogos de ' + b.ligas.length + ' ligas</h3><p class="nota">Fonte: ' + esc(b.fonte) + '. O modelo prevê semana a semana só com jogos anteriores. Regras escolhidas nas temporadas até 2023/24 e conferidas de ' + b.periodo.inicioTeste.split('-').reverse().join('/') + ' em diante. Retorno = lucro ÷ total apostado, com 1 unidade por aposta.</p>'
      + '<div class="tabela"><table><thead><tr><th>Teste</th><th class="num">Modelo</th><th class="num">Bet365</th><th class="num">Pinnacle</th></tr></thead><tbody><tr><td>Log loss 1X2 ↓</td><td class="num">' + num(q.teste.logLoss1x2.modelo, 4) + '</td><td class="num">' + num(q.teste.logLoss1x2.bet365, 4) + '</td><td class="num"><b>' + num(q.teste.logLoss1x2.pinnacle, 4) + '</b></td></tr><tr><td>Log loss mais/menos 2,5 ↓</td><td class="num">' + num(q.teste.logLossOver25.modelo, 4) + '</td><td class="num">' + num(q.teste.logLossOver25.bet365, 4) + '</td><td class="num"><b>' + num(q.teste.logLossOver25.pinnacle, 4) + '</b></td></tr></tbody></table></div>'
      + '<h4>Quanto cada faixa de odd rende (todas as apostas da faixa, teste)</h4><div class="tabela"><table><thead><tr><th>Odd</th><th class="num">Apostas</th><th class="num">Acerto</th><th class="num">Preço indica</th><th class="num">Retorno Bet365</th><th class="num">Retorno melhor odd</th><th class="num">Pior sequência</th></tr></thead><tbody>' + faixas + '</tbody></table></div><p class="nota">Odd alta paga mais, mas acerta menos do que o preço indica: a margem das casas é maior nas zebras. Pegar a melhor odd entre as casas é o que mais reduz a perda em todas as faixas.</p>'
      + (ra ? '<h4>Regras dos palpites (teste, 2024/25 em diante)</h4><div class="tabela"><table><thead><tr><th>Palpite</th><th class="num">Apostas</th><th class="num">Acerto</th><th class="num">Odd média</th><th class="num">Bet365 antes</th><th class="num">Bet365 fechamento</th><th class="num">Melhor odd</th></tr></thead><tbody>' + [['valorPinnacle', 'Valor (contra a Pinnacle)'], ['principal5', 'Principal'], ['oddMaior26', 'Odd maior'], ['principal', 'Principal antiga (8 p.p.)'], ['oddMaior', 'Odd maior antiga (1,70–3,20)']].filter(([k]) => ra[k]).map(([k, n]) => linhaRA(n, ra[k])).join('') + '</tbody></table></div>'
        + (ra.valorPinnacle && ra.valorPinnacle.porTemporada ? '<p class="nota"><b>Valor, temporada a temporada:</b> ' + Object.entries(ra.valorPinnacle.porTemporada).filter(([, v]) => v.n >= 10).map(([t, v]) => '20' + t.slice(0, 2) + '/' + t.slice(2) + ': ' + sinal(v.retorno) + ' <small>(' + v.n + ')</small>').join(' · ') + '. Oscila muito; o último ano foi negativo.</p>' : '') : '')
      + (vars ? '<h4>Variantes do modelo (log loss no teste ↓)</h4><div class="tabela"><table><thead><tr><th>Modelo</th><th class="num">1X2</th><th class="num">2,5</th></tr></thead><tbody><tr><td>Atual</td><td class="num">' + num(q.teste.logLoss1x2.modelo, 4) + '</td><td class="num">' + num(q.teste.logLossOver25.modelo, 4) + '</td></tr>' + vars + '</tbody></table></div>' : '');
  }
  function renderValidacao() {
    const el = $('#validacao'); if (!el || S.aba !== 'validacao') return;
    const r = S.validacao || S.valPublicada || V.RELATORIO_BASE, base = r === V.RELATORIO_BASE || r.fixo;
    const mk = r.mercado, cal = r.calibracao ? r.calibracao.faixas : null, tp = r.tempos;
    el.innerHTML = '<div class="cabeca"><div><p class="sobre">' + (base ? 'MEDIDO EM 19/10/2026' : r.publicado ? 'PUBLICADO EM ' + diaHora(r.geradoEm) + ' · DADOS REAIS' : 'RODADO NESTE NAVEGADOR EM ' + diaHora(r.geradoEm)) + '</p><h1>Validação</h1></div><div class="acoes"><label class="chk"><input type="checkbox" id="val-mercado" checked> comparar com o mercado (~600 consultas)</label><label class="chk"><input type="checkbox" id="val-param"> reescolher parâmetros</label><button class="pri" id="rodar-validacao"' + (S.rodando || !S.F ? ' disabled' : '') + '>' + (S.rodando ? 'Rodando…' : 'Rodar validação') + '</button></div></div>'
      + '<p class="nota" id="val-progresso">Método: a cada semana, o modelo é ajustado só com jogos anteriores e prevê a semana seguinte. Os parâmetros são escolhidos no período de ajuste (' + r.periodoAjuste.map(d => d.split('-').reverse().join('/')).join(' a ') + ') e conferidos no período de teste (' + r.periodoTeste.map(d => d.split('-').reverse().join('/')).join(' a ') + '), que não participou da escolha. Log loss menor = previsão melhor.</p>'
      + blocoBacktest() + '<h3>Período de teste (base ESPN)</h3>' + tabelaMetricas([['Modelo (com correção ' + num(r.parametros.correcao, 1) + ')', r.teste.modelo], ['Modelo sem correção', r.teste.semCorrecao], ['Modelo sem chutes no alvo', r.teste.semChutes], ['Média da liga', r.teste.mediaDaLiga]])
      + (r.contraModeloAntigo ? '<h3>Contra o modelo antigo do hub</h3><p class="nota">Nos ' + r.contraModeloAntigo.n + ' jogos do teste que o modelo antigo conseguiu prever; ' + esc(r.contraModeloAntigo.coberturaAntigo) + '.</p>' + tabelaMetricas([['Antigo (Poisson por mando, só a liga do jogo)', Object.assign({ n: r.contraModeloAntigo.n }, r.contraModeloAntigo.antigo)], ['Atual (todas as competições)', Object.assign({ n: r.contraModeloAntigo.n }, r.contraModeloAntigo.novo)]]) : '')
      + (mk ? '<h3>Contra o mercado (DraftKings, sem margem)</h3><div class="tabela"><table><tbody><tr><td>Log loss 1X2 · modelo</td><td class="num">' + num(mk.logLoss.modelo, 4) + '</td></tr><tr><td>Log loss 1X2 · mercado no fechamento</td><td class="num"><b>' + num(mk.logLoss.mercado, 4) + '</b></td></tr>' + (mk.logLoss.aberturaMercado ? '<tr><td>Log loss 1X2 · mercado na abertura</td><td class="num">' + num(mk.logLoss.aberturaMercado, 4) + '</td></tr>' : '') + '<tr><td>Melhor peso do modelo numa mistura com o mercado</td><td class="num">' + num(mk.pesoModeloNaMistura * 100, 0) + '%</td></tr>'
        + (!mk.regras && mk.apostasSimuladas && mk.apostasSimuladas.fechamento ? '<tr><td>Apostar onde o modelo vê valor > 5% (fechamento)</td><td class="num">' + mk.apostasSimuladas.fechamento.n + ' apostas · ' + sinal(mk.apostasSimuladas.fechamento.roi) + '</td></tr><tr><td>Idem, na abertura</td><td class="num">' + mk.apostasSimuladas.abertura.n + ' apostas · ' + sinal(mk.apostasSimuladas.abertura.roi) + '</td></tr>' : '') + '</tbody></table></div>'
        + (mk.regras ? '<h3>Regras de aposta no teste (1X2 e total na linha da DraftKings)</h3>' + tabelaRegras(mk.regras) + '<p class="nota">Uma unidade por aposta, nas odds reais daquele momento. Retorno negativo = a regra perde dinheiro.</p>' : '')
        + (mk.palpites ? '<h3>Os palpites por jogo contra o resultado</h3><div class="tabela"><table><thead><tr><th>Palpite</th><th>Odd</th><th class="num">Jogos</th><th class="num">Acerto</th><th class="num">Previsto</th><th class="num">Odd média</th><th class="num">Retorno</th></tr></thead><tbody>' + ['fechamento', 'abertura'].flatMap(w => ['principal', 'oddMaior'].map(k => { const x = mk.palpites[w][k]; return '<tr><td>' + TIPO_PALPITE[k] + '</td><td>' + w + '</td><td class="num">' + x.n + '</td><td class="num">' + pct(x.taxa, 1) + '</td><td class="num">' + pct(x.previsto, 1) + '</td><td class="num">' + num(x.oddMedia) + '</td><td class="num ' + (x.retorno > 0 ? 'pos' : 'neg') + '">' + sinal(x.retorno) + '</td></tr>'; })).join('') + '</tbody></table></div><p class="nota">A mesma regra da aba Palpites, com as odds reais da DraftKings em cada momento (1X2, dupla chance e a linha principal de gols; ambas marcam fica de fora porque a fonte não guarda essas odds). Retorno de 1 unidade por palpite.</p>' : '')
        + (mk.filtroSugestoes ? '<h3>Calibração das linhas em que modelo e mercado concordam</h3><div class="tabela"><table><thead><tr><th>Faixa de chance</th><th class="num">Linhas que passam</th><th class="num">Chance prevista</th><th class="num">Aconteceu</th><th class="num">Retorno no fechamento</th><th class="num">Barradas</th><th class="num">Aconteceu nas barradas</th></tr></thead><tbody>' + mk.filtroSugestoes.map(f => '<tr><td>' + pct(f.de) + '–' + pct(f.ate) + '</td><td class="num">' + f.n + '</td><td class="num">' + pct(f.previsto, 1) + '</td><td class="num">' + pct(f.aconteceu, 1) + '</td><td class="num">' + sinal(f.roi) + '</td><td class="num">' + f.rejeitadas + '</td><td class="num">' + pct(f.aconteceuRejeitadas, 1) + '</td></tr>').join('') + '</tbody></table></div><p class="nota">Chance prevista = média de modelo e mercado. Se "aconteceu" fica perto da prevista, o filtro não deixa passar linha ruim disfarçada.</p>' : '')
        + '<p class="nota">Leitura: o mercado erra menos que o modelo, e apostar só onde o modelo vê valor perdeu dinheiro. Por isso o hub mostra o modelo na frente (é a opinião própria dele), mas as sugestões só usam linhas em que modelo e mercado concordam.</p>' : '')
      + (tp ? '<h3>Mercados de tempo</h3><div class="tabela"><table><thead><tr><th></th><th class="num">Jogos</th><th class="num">Gol no 2º tempo ↓</th><th class="num">Tempo com mais gols ↓</th><th class="num">Quem marca primeiro ↓</th></tr></thead><tbody><tr><td>Modelo</td><td class="num">' + tp.modelo.n + '</td><td class="num">' + num(tp.modelo.gol2T, 4) + '</td><td class="num">' + num(tp.modelo.tempoMaisGols, 4) + '</td><td class="num">' + num(tp.modelo.primeiroGol, 4) + '</td></tr><tr><td>Média da liga</td><td class="num">' + tp.mediaDaLiga.n + '</td><td class="num">' + num(tp.mediaDaLiga.gol2T, 4) + '</td><td class="num">' + num(tp.mediaDaLiga.tempoMaisGols, 4) + '</td><td class="num">' + num(tp.mediaDaLiga.primeiroGol, 4) + '</td></tr></tbody></table></div>' : '')
      + (r.escanteios ? '<h3>Escanteios e cartões (sem odds na fonte)</h3><div class="tabela"><table><thead><tr><th></th><th class="num">Jogos</th><th class="num">Log loss modelo</th><th class="num">Log loss média da liga</th><th class="num">Erro médio modelo</th><th class="num">Erro médio liga</th></tr></thead><tbody><tr><td>Escanteios, over 9,5</td><td class="num">' + r.escanteios.n + '</td><td class="num">' + num(r.escanteios.over95.modelo, 3) + '</td><td class="num">' + num(r.escanteios.over95.mediaDaLiga, 3) + '</td><td class="num">' + num(r.escanteios.erroMedio.modelo, 2) + '</td><td class="num">' + num(r.escanteios.erroMedio.mediaDaLiga, 2) + '</td></tr><tr><td>Cartões, over 4,5</td><td class="num">' + r.cartoes.n + '</td><td class="num">' + num(r.cartoes.over45.modelo, 3) + '</td><td class="num">' + num(r.cartoes.over45.mediaDaLiga, 3) + '</td><td class="num">' + num(r.cartoes.erroMedio.modelo, 2) + '</td><td class="num">' + num(r.cartoes.erroMedio.mediaDaLiga, 2) + '</td></tr></tbody></table></div>' : '')
      + (cal ? '<h3>Calibração do modelo no teste</h3><div class="faixas">' + cal.map(f => '<div class="faixa"><span>' + Math.round(f.de * 100) + '–' + Math.round(f.ate * 100) + '%</span><i style="width:' + (f.aconteceu * 100).toFixed(0) + '%"></i><b>' + pct(f.aconteceu) + '</b><small>previsto ' + pct(f.previsto) + ' · ' + f.n + '</small></div>').join('') + '</div><p class="nota">Desvio médio: ' + num(r.calibracao.erroMedio * 100, 1) + ' p.p.</p>' : '<p class="nota">No teste de 19/10, o desvio médio de calibração do 1X2 foi de ' + num((r.calibracao1x2 || {}).modelo * 100, 1) + ' p.p. no modelo e ' + num((r.calibracao1x2 || {}).mercado * 100, 1) + ' p.p. no mercado. A tabela por faixas aparece quando você roda a validação neste navegador.</p>')
      + (r.cansaco ? '<h3>Cansaço e calendário</h3><p class="nota">' + esc(r.cansaco) + ' O hub mostra o calendário completo de cada time como contexto, sem mexer na probabilidade.</p>' : '')
      + (!base && r.parametros ? '<p class="nota">Parâmetros desta rodada: meia-vida ' + r.parametros.meiaVida + ' dias, chutes no alvo ' + num(r.parametros.pesoChutesNoAlvo * 100, 0) + '%, correção ' + num(r.parametros.correcao, 1) + '. <button class="sec" id="aplicar-param">Usar estes parâmetros</button> <button class="link" id="param-padrao">Voltar ao padrão</button></p>' : '')
      + '<h3>Como o hub calcula</h3><ul class="metodo"><li><b>Força dos clubes:</b> um único modelo para 30 competições. Ataque e defesa de cada clube, nível de cada liga, fator casa por competição, peso maior para jogos recentes (meia-vida de 270 dias); mistura gols com chutes no alvo, que oscilam menos.</li><li><b>Modelo na frente:</b> a chance mostrada primeiro é sempre a do modelo; o mercado sem margem fica ao lado para comparar.</li><li><b>Odd sugerida:</b> média das casas que cotam a linha; sem cotação, o preço justo do mercado (ou do modelo) com a margem típica das casas (5,5%).</li><li><b>Palpites:</b> por jogo, sem múltiplas: a linha de maior chance nos seus mercados com odd de pelo menos 1,35 e modelo e mercado de acordo; quando nada passa, "nada bom".</li><li><b>Bilhete:</b> linhas do mesmo jogo pela interseção dos placares; jogos diferentes como independentes.</li><li><b>Limites:</b> escalações e desfalques não entram no modelo; escanteios e cartões não têm odd para conferir; odds de jogador só quando a Bet365 publica pela ESPN.</li></ul>';
  }
  async function rodarValidacao() {
    if (S.rodando || !S.F) return; S.rodando = true; const comMercado = $('#val-mercado') && $('#val-mercado').checked, escolher = $('#val-param') && $('#val-param').checked; renderValidacao();
    try { const rel = await V.rodar(S.jogos, { comMercado, escolherParametros: escolher, onProgress: t => { const p = $('#val-progresso'); if (p) p.textContent = t; } }); S.validacao = rel; await R.kv.put('kv', 'validacao', rel); toast('Validação concluída.'); }
    catch (e) { toast('Falha na validação: ' + (e.message || e)); }
    S.rodando = false; renderValidacao();
  }

  /* ---------- Eventos ---------- */
  function bind() {
    $('#dia').addEventListener('change', e => { S.dia = e.target.value || hojeSP(); S.sel.clear(); carregarAgenda(); });
    $('#hoje').addEventListener('click', () => { S.dia = hojeSP(); $('#dia').value = S.dia; S.sel.clear(); carregarAgenda(); navegar('radar'); });
    window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (ABAS.includes(h)) navegar(h); });
    document.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.comp) { if (t.checked) S.comps.add(t.dataset.comp); else S.comps.delete(t.dataset.comp); gravarPref(); carregarAgenda(); }
      else if (t.id === 'mostrar-todos') { S.todos = t.checked; gravarPref(); renderRadar(); }
      else if (t.dataset.sel) { if (t.checked) S.sel.add(t.dataset.sel); else S.sel.delete(t.dataset.sel); const b = $('#analisar-sel'); if (b) b.textContent = 'Analisar selecionados (' + S.sel.size + ')'; }
      else if (t.dataset.odd) { B.definirOdd(t.dataset.odd, parseFloat(String(t.value).replace(',', '.'))); renderBilhete(); }
      else if (t.id === 'importar' && t.files && t.files[0]) { t.files[0].text().then(D.importar).then(n => { toast(n + ' registros importados.'); renderDiario(); }).catch(err => toast('Importação recusada: ' + err.message)); }
    });
    document.addEventListener('click', async e => {
      const t = e.target.closest('button, a'); if (!t) return;
      if (t.dataset.ir) { navegar(t.dataset.ir); return; }
      if (t.dataset.analisar) { analisar([t.dataset.analisar]); return; }
      if (t.dataset.add) { const [id, ...k] = t.dataset.add.split('|'), a = S.analises.get(id), l = a && a.linhas.find(x => x.chave === k.join('|')); if (a && l) { B.adicionar(a, l); toast('Adicionada ao bilhete: ' + l.rotulo + ' a ' + num(l.odd)); render(); } return; }
      if (t.dataset.fam) { const [id, f] = t.dataset.fam.split('|'); S.familia[id] = f; renderAnalise(); const c = $('#a-' + id); if (c) { const d = c.querySelectorAll('details')[0]; if (d) d.open = true; c.scrollIntoView({ block: 'nearest' }); } return; }
      if (t.dataset.rem) { B.remover(t.dataset.rem); render(); return; }
      if (t.dataset.del) { await D.remover(t.dataset.del); renderDiario(); return; }
      if (t.dataset.copiar) { const a = S.analises.get(t.dataset.copiar); if (a) toast(await copiar(textoAnalise(a)) ? 'Análise copiada.' : 'Não consegui copiar; use Baixar.'); return; }
      if (t.dataset.baixar) { const a = S.analises.get(t.dataset.baixar); if (a) baixar('ponto-comum-' + R.dataSP(a.m.date) + '-' + (a.m.hn + '-' + a.m.an).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-') + '.json', JSON.stringify(dadosAnalise(a), null, 1)); return; }
      switch (t.id) {
        case 'recarregar': carregarRedeEModelos(true); carregarAgenda(); break;
        case 'sel-todos': for (const m of S.agenda) if (S.comps.has(m.comp) && filtraGrandes(m) && !m.done && Date.parse(m.date) > Date.now()) S.sel.add(m.id); renderRadar(); break;
        case 'analisar-sel': if (!S.sel.size) toast('Marque ao menos uma partida.'); else analisar([...S.sel]); break;
        case 'limpar-analises': S.analises.clear(); renderAnalise(); break;
        case 'copiar-todas': { const ls = [...S.analises.values()].sort((x, y) => Date.parse(x.m.date) - Date.parse(y.m.date)); toast(await copiar(ls.map(textoAnalise).join('\n\n———\n\n')) ? ls.length + ' análises copiadas.' : 'Não consegui copiar; use Baixar.'); break; }
        case 'copiar-palpites': { const ls = doDiaParaPalpites().map(m => S.analises.get(m.id)).filter(Boolean).sort((x, y) => Date.parse(x.m.date) - Date.parse(y.m.date)); toast(await copiar(textoPalpites(ls)) ? 'Palpites copiados.' : 'Não consegui copiar.'); break; }
        case 'baixar-todas': baixar('ponto-comum-analises-' + S.dia + '.json', JSON.stringify([...S.analises.values()].map(dadosAnalise), null, 1)); break;
        case 'limpar-bilhete': B.limpar(); render(); break;
        case 'acompanhar': case 'registrar-aposta': {
          const ps = B.lista(); if (!ps.length) break; const av = B.avaliar(ps, S.analises), lerN = id => parseFloat(String(($('#' + id) || {}).value || '').replace(',', '.'));
          const valor = lerN('valor-aposta'), oddPega = lerN('odd-pega'), nivel = ps.length > 1 ? 'multipla' : 'simples';
          if (t.id === 'registrar-aposta' && !(valor > 0)) { toast('Informe o valor apostado.'); break; }
          if (t.id === 'registrar-aposta' && !av.odd && !(oddPega > 1)) { toast('Informe a odd que você pegou.'); break; }
          await D.salvarBilhete(ps, av, { modo: t.id === 'acompanhar' ? 'acompanhar' : 'aposta', valor, oddPega, nivel }); toast(t.id === 'acompanhar' ? 'Bilhete salvo para acompanhar.' : 'Aposta registrada: ' + reais(valor) + ' a ' + num(oddPega > 1 ? oddPega : av.odd) + '.'); break; }
        case 'apurar': {
          t.disabled = true; t.textContent = 'Apurando…';
          const lista = await D.todos(), pend = lista.filter(r => !r.apurado && Date.parse(r.inicio) + 2.5 * 3600e3 < Date.now()), porDia = new Map();
          for (const r of pend) for (const x of r.tipo === 'bilhete' ? r.pernas : [r]) { const d = R.dataSP(x.inicio); if (!porDia.has(d)) porDia.set(d, new Set()); porDia.get(d).add(x.comp); }
          for (const [d, cs] of [...porDia.entries()].slice(-14)) { try { const r = await R.carregarDia(d, [...cs]); mesclar(r.jogos); } catch { /* tenta com a rede atual */ } }
          const res = await D.apurar(S.porId); toast(res.apurados + ' registro(s) apurado(s)' + (res.comClv ? ', ' + res.comClv + ' com CLV' : '') + '.'); renderDiario(); break; }
        case 'exportar': baixar('ponto-comum-diario-' + hojeSP() + '.json', await D.exportar()); break;
        case 'rodar-validacao': rodarValidacao(); break;
        case 'aplicar-param': if (S.validacao && S.validacao.parametros) { await R.kv.put('kv', 'parametros', Object.assign({ aplicar: true }, S.validacao.parametros)); toast('Parâmetros aplicados. Reajustando o modelo…'); carregarRedeEModelos(); } break;
        case 'param-padrao': await R.kv.del('kv', 'parametros'); toast('Parâmetros padrão restaurados.'); carregarRedeEModelos(); break;
      }
    });
  }

  async function iniciar() {
    lerPref(); bind(); $('#dia').value = S.dia;
    const v = await R.kv.get('kv', 'validacao'); if (v && v.teste && v.tempos) S.validacao = v;
    R.carregarDados('validacao.json').then(x => { if (x && x.teste) { S.valPublicada = Object.assign(x, { publicado: true }); if (S.validacao && Date.parse(S.validacao.geradoEm) < Date.parse(x.geradoEm)) S.validacao = null; if (S.aba === 'validacao') renderValidacao(); } });
    R.carregarDados('revisao.json').then(x => { S.revisao = x || false; if (S.aba === 'diario') renderDiario(); });
    R.carregarDados('backtest.json').then(x => { S.backtest = x || null; if (S.aba === 'validacao') renderValidacao(); });
    const h = location.hash.slice(1); navegar(ABAS.includes(h) ? h : 'radar');
    carregarAgenda(); carregarRedeEModelos();
    setInterval(() => { if (S.aba === 'radar' && S.dia === hojeSP()) carregarAgenda(); }, 5 * 60e3);
  }
  globalThis.PontoComum = Object.freeze({ estado: S, analisar, navegar, recarregar: () => carregarRedeEModelos(true), textoAnalise, dadosAnalise });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
