# Ponto Comum v3

Hub de análise de futebol pré-jogo que roda inteiro no navegador. Usa os dados públicos da ESPN: placares, estatísticas e odds da DraftKings e da Bet365. Abra `ponto-comum-portatil.html` direto no navegador (funciona sem servidor).

## O que mudou na v3

| Pedido | Como ficou |
|---|---|
| Modelo na frente | Toda linha mostra primeiro a chance do **modelo** (com faixa de 90%), depois a do mercado sem margem. Diferença acima de 8 p.p. ganha a etiqueta "diverge" |
| Odd já pronta | **Odd sugerida** em toda linha: média das casas que cotam a linha; sem cotação, o preço justo do mercado (ou do modelo) com a margem típica das casas (5,5%). O bilhete já vem com essas odds; você pode trocar pela da sua casa |
| Menos linhas | Tabela principal só com 1X2, dupla chance, ambas marcam e mais/menos gols (as quase certas, acima de 92%, saem). O resto fica fechado em "Outras linhas". Escanteios e cartões só aparecem em destaque ("Fora do normal") quando a chance passa bem da média da competição |
| Níveis de risco | **Segura** odd 2,4–4,5 · **Média** 9–12 · **Arriscada** 15–50 · **Bingo** 100–1.500. Filtro meio-termo: modelo e mercado a até 8 p.p. em cada perna, nenhuma perna acima de 92%, times com 12+ jogos, uma perna por jogo. Dentro da faixa, escolhe a combinação de maior chance (costuma usar poucas pernas, porque a margem da casa se acumula a cada perna) |
| Competições | Radar: Champions + Premier League (todos os jogos) + LaLiga, Serie A, Bundesliga e Ligue 1 só com jogos dos grandes (4, 6, 3 e 3 clubes mais fortes pelo modelo, recalculados a cada atualização). Brasileirão, Europa, Conference, Libertadores e Sul-Americana ficam como opcionais. A rede de 30 competições continua alimentando a força dos clubes |
| Linhas alternativas | Entraram 2º tempo, tempo com mais gols e quem marca primeiro (validados na aba Validação) e **quem pode marcar** (experimental: a fonte não tem odd de jogador para conferir) |
| Diário com apostas reais | Registre valor, odd que pegou e nível. O diário mostra lucro, retorno por nível, CLV e a **revisão jogo a jogo**: o que o hub disse × o que aconteceu |
| Exportar análise | Cada análise tem **Copiar** (texto pronto para colar) e **Baixar** (JSON). Também dá para copiar ou baixar todas |

## Validação medida em 19/10/2026

Método semana a semana: a cada semana, o modelo é ajustado só com jogos anteriores e prevê a semana seguinte. Log loss menor = previsão melhor. Teste de 01/07 a 19/10/2026, fora da escolha dos parâmetros.

| Período de teste (635 jogos) | 1X2 | Over 2,5 | Ambas marcam |
|---|---|---|---|
| Modelo (correção 1,2) | **0,9675** | **0,6621** | 0,6793 |
| Modelo sem chutes no alvo | 0,9784 | 0,6681 | 0,6824 |
| Média da liga | 1,0634 | 0,6933 | 0,6849 |

- **Contra o modelo antigo** (460 jogos que ele prevê): melhor nos três mercados; o antigo não cobre 28% dos jogos.
- **Contra o mercado** (fechamento DraftKings, 609 jogos): mercado 0,9347 × modelo 0,9725. Apostar onde só o modelo via valor > 5% perdeu 25,7%. Por isso as sugestões exigem modelo e mercado de acordo.
- A aba Validação roda de novo no seu navegador e acrescenta: regras de aposta na abertura e no fechamento, o filtro das sugestões contra o resultado real, e os mercados de tempo.

## Arquivos

```
index.html        interface (Radar, Análise, Bilhete, Diário, Validação)
style.css         estilo (tema claro e escuro)
js/rede.js        competições, leitura da ESPN, cache, elencos, calendário, forma, confrontos
js/modelo.js      modelo de força, matriz de placares, mercados, tempos, 1º gol, quem marca
js/mercado.js     cotações, probabilidade sem margem, referência do mercado, odd sugerida
js/analise.js     linhas de uma partida (modelo na frente), destaques, alertas
js/bilhete.js     bilhete com chance conjunta e sugestões em quatro níveis
js/diario.js      previsões e apostas, apuração, CLV, revisão jogo a jogo
js/validacao.js   validação semana a semana, mercado, regras, filtro, tempos
```

## Fontes (ESPN, sem chave)

- Placar por competição e ano: `site.api.espn.com/apis/site/v2/sports/soccer/{liga}/scoreboard?dates=AAAA&limit=1000`
- Agenda do dia: o mesmo com `dates=AAAAMMDD` (traz odds da DraftKings dos jogos futuros)
- Resumo da partida (Bet365, escalações, desfalques, árbitro): `.../{liga}/summary?event={id}`
- Elenco com estatísticas: `.../{liga}/teams/{id}/roster`
- Abertura e fechamento da DraftKings: `sports.core.api.espn.com/v2/sports/soccer/leagues/{liga}/events/{id}/competitions/{id}/odds`

## Regras para manter

1. Valor esperado só conta com odd cotada por uma casa. Com odd estimada ele só repete a diferença entre modelo e mercado.
2. Mudança no modelo só entra se melhorar o log loss no período de teste da aba Validação.
3. Para incluir competição, acrescente uma linha em `COMPS` (`rede.js`). Para mudar quantos grandes por liga, `GRANDES_POR_LIGA`.

Ferramenta de análise: nenhum resultado é garantido e nada aqui é recomendação de aposta.
