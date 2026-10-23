# Ponto Comum v3

Hub de análise de futebol pré-jogo que roda inteiro no navegador. Usa os dados públicos da ESPN: placares, estatísticas e odds da DraftKings e da Bet365. No ar em **https://stonkswill.github.io/ponto-comum/**. `ponto-comum-portatil.html` é a versão de um arquivo só (abre direto no navegador, sem os dados do robô).

## O que mudou na v3

| Pedido | Como ficou |
|---|---|
| Modelo na frente | Toda linha mostra primeiro a chance do **modelo** (com faixa de 90%), depois a do mercado sem margem. Diferença acima de 8 p.p. ganha a etiqueta "diverge" |
| Odd já pronta | **Odd sugerida** em toda linha: média das casas que cotam a linha; sem cotação, o preço justo do mercado (ou do modelo) com a margem típica das casas (5,5%). Nos palpites aparece a melhor odd e em qual casa |
| Menos linhas | Tabela principal só com 1X2, dupla chance, ambas marcam e mais/menos gols (as quase certas, acima de 92%, saem). O resto fica fechado em "Outras linhas". Escanteios e cartões só aparecem em destaque ("Fora do normal") quando a chance passa bem da média da competição |
| Palpites por jogo (sem múltiplas) | Aba **Palpites**: para cada jogo do radar, a aposta **principal** (maior chance nos seus mercados com odd ≥ 1,35 e modelo e mercado a até 5 p.p.), uma de **odd maior** (1,70–2,60), o **fora do normal** (escanteios, cartões, tempos) e o **jogador** com mais chance de marcar entre os que têm odd. Sem nada bom, o hub diz "nada bom". O criador de múltiplas, o bilhete e o diário saíram do app |
| Competições | Radar: Champions + Premier League (todos os jogos) + LaLiga, Serie A, Bundesliga e Ligue 1 só com jogos dos grandes (4, 6, 3 e 3 clubes mais fortes pelo modelo, recalculados a cada atualização). Brasileirão, Europa, Conference, Libertadores e Sul-Americana ficam como opcionais. A rede de 30 competições continua alimentando a força dos clubes |
| Linhas alternativas | Entraram 2º tempo, tempo com mais gols e quem marca primeiro (validados na aba Validação) e **quem pode marcar** (experimental: a fonte não tem odd de jogador para conferir) |
| Histórico | O app não registra nada no aparelho. O robô grava os palpites de cada jogo (com a odd principal e a melhor odd) em `dados/previsoes/` antes do início e confere depois em `dados/revisao.json`; o resumo aparece na aba Validação |
| Exportar análise | Cada análise tem **Copiar** (texto pronto para colar) e **Baixar** (JSON). Também dá para copiar ou baixar todas |

## Robô de dados (GitHub Actions)

O repositório tem um robô (`.github/workflows/coleta.yml` → `ferramentas/coletar.mjs`) que roda 7 vezes por dia e grava em `dados/`:

| Pasta | O que é |
|---|---|
| `dados/rede/` | Base de jogos das 30 competições (3 anos). O site carrega daqui primeiro: abre rápido no celular |
| `dados/odds/` | Abertura e fechamento da DraftKings dos jogos encerrados das competições do radar, com os gols esperados implícitos no preço |
| `dados/pre/` | Cotações (DraftKings e Bet365) dos jogos das próximas 40 h, a última antes do início |
| `dados/previsoes/` | O que o hub disse antes de cada jogo (todas as linhas, a leitura e os palpites), congelado no início |
| `dados/revisao.json` | O que o hub disse × o que aconteceu: acerto e retorno de cada tipo de palpite, erro do modelo e do mercado, modelo de jogador × Bet365 |
| `dados/validacao.json` | Validação semana a semana com dados reais (gerada com `node ferramentas/validar.mjs`) |

Para testar uma mudança no modelo: `node ferramentas/experimento.mjs` (usa só os arquivos de `dados/`, sem internet). Antes de publicar mudanças no site: `node ferramentas/versao.mjs` (carimba a versão dos arquivos para o navegador não misturar novo e velho).

## Validação com dados reais (22/10/2026)

Teste de 16/07 a 22/10/2026 (691 jogos do radar), parâmetros escolhidos antes desse período. Log loss menor = melhor.

| | 1X2 | Over 2,5 | Ambas marcam |
|---|---|---|---|
| Modelo atual | **0,9697** | **0,6592** | 0,6804 |
| Modelo da v3 original | 0,9743 | 0,6588 | 0,6788 |
| Média da liga | 1,0652 | 0,6907 | 0,6833 |

- **Mercado** (DraftKings sem margem, 665 jogos): fechamento 0,9308, abertura 0,9394, modelo 0,9663. Peso ótimo do modelo numa mistura: 0%.
- **Regras de aposta por valor** perdem dinheiro na abertura e no fechamento (−13% a −31%). Por isso as sugestões não apostam em "valor": usam linhas em que modelo e mercado concordam.
- **Palpites por jogo** (mesma regra da aba Palpites, odds reais da DraftKings, jul–out): principal acertou 65,2% no fechamento (previsto 60,4%), odd média 1,60, retorno +2,8%; na abertura, 59,6% e −6,0%. Odd maior: −7,5% (fechamento) e −9,1% (abertura). Em 745 jogos de mai–out, a principal ficou em +0,2%. Ou seja: perto do empate, sem vantagem garantida.
- **Calibração**: nas linhas em que modelo e mercado concordam, a chance prevista bate com o que acontece.
- **Quem marca primeiro**: modelo 0,836 × média da liga 0,877. 2º tempo e tempo com mais gols: ganho pequeno.
- **Viés favorito–zebra** (2.418 jogos): favoritos fortes acontecem um pouco mais que o preço indica e zebras um pouco menos, mas apostar nos favoritos só empata depois da margem.

O que mudou no modelo com esses dados: forças dos clubes mais espalhadas, metade do alvo dos jogos passados vindo dos gols esperados implícitos no fechamento do mercado, e margem do 1X2 retirada pelo método da potência.

## Backtest financeiro (23/10/2026)

`node ferramentas/backtest.mjs` (base da football-data.co.uk, baixada pelo robô de fontes externas): 18.359 jogos de 8 ligas europeias com previsão semana a semana desde 2020/21, odds da Bet365, Pinnacle, média e melhor odd do mercado, de antes da rodada e de fechamento. Regras escolhidas até 2023/24 e conferidas de 2024/25 em diante.

- **Faixas de odd** (todas as apostas, Bet365 antes da rodada, teste): 1,35–5,00 perdem de 4,6% a 7,8%; 5–8, −11%; 8–13, −38%; 13+, −46%. Odd alta paga mais, mas acerta bem menos do que o preço indica. Pegando a melhor odd do mercado, a perda cai para −1,5% a −3% nas faixas até 5.
- **Valor contra a Pinnacle** (Bet365 acima do preço justo da Pinnacle, odd 2,60–13): treino +12,0%, teste +5,9%, acerto 27,5%, odd média 4,21. Por temporada: +0, +11, +5, +33, +22% e depois −25% (2025/26) e −17% (2026/27). A football-data deixou de receber odds da Pinnacle em 2025/26 e a bolsa da Betfair, testada como substituta, é menos afiada que a própria Bet365 antes da rodada (log loss 0,9779 × 0,9714). **Desligado** no site: hoje não há fonte nem evidência recente.
- **Principal** (maior chance, odd ≥ 1,35, modelo e mercado a até 5 p.p.): −4,3% na Bet365, −1,4% com a melhor odd. **Odd maior** (1,70–2,60): −3,3% e −1,4%.
- **Modelo**: xG do Understat (50% do alvo) e preços de fechamento da Pinnacle dos jogos passados melhoram a previsão; a Pinnacle segue melhor que o modelo e que a Bet365.

## Arquivos

```
index.html        interface (Radar, Palpites, Análise, Validação)
style.css         estilo (tema claro e escuro)
js/rede.js        competições, leitura da ESPN, cache, elencos, calendário, forma, confrontos
js/modelo.js      modelo de força, matriz de placares, mercados, tempos, 1º gol, quem marca
js/mercado.js     cotações, probabilidade sem margem, referência do mercado, odd sugerida
js/analise.js     linhas de uma partida (modelo na frente), palpites por jogo, destaques, alertas
js/diario.js      apuração de uma linha pelo placar (usado só pelo robô)
js/validacao.js   validação semana a semana, mercado, regras, filtro, tempos
ferramentas/      robôs (coleta e fontes externas), revisão, validação, backtest e experimentos (Node, sem navegador)
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
