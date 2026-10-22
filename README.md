# Ponto Comum v3

Hub de análise de futebol pré-jogo que roda inteiro no navegador. Usa os dados públicos da ESPN: placares, estatísticas e odds da DraftKings e da Bet365. No ar em **https://stonkswill.github.io/ponto-comum/**. `ponto-comum-portatil.html` é a versão de um arquivo só (abre direto no navegador, sem os dados do robô).

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

## Robô de dados (GitHub Actions)

O repositório tem um robô (`.github/workflows/coleta.yml` → `ferramentas/coletar.mjs`) que roda 7 vezes por dia e grava em `dados/`:

| Pasta | O que é |
|---|---|
| `dados/rede/` | Base de jogos das 30 competições (3 anos). O site carrega daqui primeiro: abre rápido no celular |
| `dados/odds/` | Abertura e fechamento da DraftKings dos jogos encerrados das competições do radar, com os gols esperados implícitos no preço |
| `dados/pre/` | Cotações (DraftKings e Bet365) dos jogos das próximas 40 h, a última antes do início |
| `dados/previsoes/` | O que o hub disse antes de cada jogo (todas as linhas, a leitura e os bilhetes sugeridos), congelado no início |
| `dados/revisao.json` | O que o hub disse × o que aconteceu: acertos da leitura, retorno dos bilhetes por nível, erro do modelo e do mercado |
| `dados/validacao.json` | Validação semana a semana com dados reais (gerada com `node ferramentas/validar.mjs`) |

Para testar uma mudança no modelo: `node ferramentas/experimento.mjs` (usa só os arquivos de `dados/`, sem internet).

## Validação com dados reais (22/10/2026)

Teste de 16/07 a 22/10/2026 (691 jogos do radar), parâmetros escolhidos antes desse período. Log loss menor = melhor.

| | 1X2 | Over 2,5 | Ambas marcam |
|---|---|---|---|
| Modelo atual | **0,9697** | **0,6592** | 0,6804 |
| Modelo da v3 original | 0,9743 | 0,6588 | 0,6788 |
| Média da liga | 1,0652 | 0,6907 | 0,6833 |

- **Mercado** (DraftKings sem margem, 665 jogos): fechamento 0,9308, abertura 0,9394, modelo 0,9663. Peso ótimo do modelo numa mistura: 0%.
- **Regras de aposta por valor** perdem dinheiro na abertura e no fechamento (−13% a −31%). Por isso as sugestões não apostam em "valor": usam linhas em que modelo e mercado concordam.
- **Filtro das sugestões**: nas linhas que passam, a chance prevista bate com o que acontece (média: 53,5% previsto, 53,2% real; arriscada: 43,4% × 45,6%).
- **Quem marca primeiro**: modelo 0,836 × média da liga 0,877. 2º tempo e tempo com mais gols: ganho pequeno.
- **Viés favorito–zebra** (2.418 jogos): favoritos fortes acontecem um pouco mais que o preço indica e zebras um pouco menos, mas apostar nos favoritos só empata depois da margem.

O que mudou no modelo com esses dados: forças dos clubes mais espalhadas, metade do alvo dos jogos passados vindo dos gols esperados implícitos no fechamento do mercado, e margem do 1X2 retirada pelo método da potência.

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
ferramentas/      robô de coleta, revisão, validação e experimentos (Node, sem navegador)
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
