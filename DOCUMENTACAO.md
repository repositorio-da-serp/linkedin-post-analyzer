# LinkedIn Post Analyzer

**Extensão para Google Chrome · Versão 1.7.1 · 2026-08-03 12:20**

Documentação técnica completa. Público-alvo: usuários avançados, mantenedores e desenvolvedores que precisem operar, auditar ou evoluir a extensão.

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Princípios de projeto](#2-princípios-de-projeto)
3. [Instalação e requisitos](#3-instalação-e-requisitos)
4. [Guia de uso](#4-guia-de-uso)
5. [Arquitetura](#5-arquitetura)
6. [Inventário de arquivos](#6-inventário-de-arquivos)
7. [Camada de extração e estratégias de resiliência](#7-camada-de-extração-e-estratégias-de-resiliência)
8. [Motor de análise local](#8-motor-de-análise-local)
9. [Modo IA](#9-modo-ia)
10. [Modelo de dados](#10-modelo-de-dados)
11. [Exportações](#11-exportações)
12. [Permissões, privacidade e segurança](#12-permissões-privacidade-e-segurança)
13. [Observabilidade e diagnóstico](#13-observabilidade-e-diagnóstico)
14. [Testes](#14-testes)
15. [Guia de manutenção](#15-guia-de-manutenção)
16. [Limitações conhecidas](#16-limitações-conhecidas)
17. [Histórico de versões](#17-histórico-de-versões)
18. [Aviso de responsabilidade](#18-aviso-de-responsabilidade)

---

## 1. Visão geral

O LinkedIn Post Analyzer (LPA) lê a publicação do LinkedIn aberta na aba ativa e produz uma análise estruturada em sete dimensões: identificação do post e do autor, métricas de engajamento, avaliação heurística do conteúdo, engenharia do gancho, sentimento e clusters comportamentais dos comentários, hipóteses de motivação (reações, comentários, compartilhamentos) e um relatório diagnóstico exportável em JSON, CSV, Markdown e HTML.

A extensão opera em dois modos:

| Modo | O que faz | Requisito |
|---|---|---|
| **Local** (padrão) | Extração + análise por regras e léxicos embutidos. Nenhum byte sai do navegador. | Nenhum |
| **Local + IA** (opcional) | Substitui sentimento e clusters por classificação semântica e adiciona narrativa interpretativa. | Chave de API própria (Anthropic ou OpenAI) e consentimento por análise |

Números da versão 1.7.1: 12 arquivos de código (~3.400 linhas), 87 testes automatizados, 30 cenários de teste manual documentados.

## 2. Princípios de projeto

Estes princípios governaram todas as decisões e devem ser preservados em evoluções futuras.

**Leitura passiva, sob demanda.** A extensão só lê o que já está renderizado no DOM da aba, exclusivamente quando o usuário aciona a análise. Nunca clica, rola, navega ou carrega conteúdo automaticamente. Não há content script permanente: o leitor é injetado por `chrome.scripting.executeScript` a cada acionamento e não deixa listeners.

**Honestidade epistêmica.** Todo número carrega `precision` (`exact`, `abbreviated`, `estimated`, `unavailable`); valor não visível vira indisponível, nunca zero inventado. Toda interpretação carrega `kind` (`observation`, `hypothesis`, `heuristic`) e, quando aplicável, `confidence` e `rationale`. Índices 0-100 declaram a fórmula e avisam que não são métricas oficiais do LinkedIn. A cobertura da amostra acompanha todas as conclusões.

**Resiliência por camadas.** O DOM do LinkedIn muda com frequência e circula em múltiplas variantes simultâneas (classes semânticas clássicas, `data-view-name`, classes totalmente ofuscadas). A extração usa quatro camadas de estratégia com degradação suave; ver seção 7.

**Privacidade por padrão.** Sem telemetria, analytics, CDN ou código remoto. O modo IA exige consentimento explícito por análise, com inventário do que será e do que não será enviado, e as permissões de rede para os provedores são opcionais e solicitadas apenas em runtime.

**Observabilidade.** Toda extração registra quais estratégias funcionaram, quais falharam e o que existe na página, permitindo diagnosticar mudanças do LinkedIn a partir do próprio JSON exportado, sem acesso à máquina do usuário. Esse mecanismo foi o que permitiu estabilizar a extensão em campo ao longo das versões 1.1 a 1.6.

## 3. Instalação e requisitos

Requisitos: Google Chrome 116 ou superior (API de side panel).

1. Extraia a pasta do projeto.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta.
4. Confirme a versão **1.7.1** no card da extensão.
5. Fixe o ícone; clicar nele abre o painel lateral.

Atualização: substitua os arquivos da pasta, clique no ícone de recarga no card da extensão e **recarregue também a aba do LinkedIn** (a injeção anterior fica órfã após o reload da extensão).

## 4. Guia de uso

### 4.1 Fluxo básico

1. Abra uma publicação específica: URLs aceitas são `linkedin.com/feed/update/urn:li:activity:...`, `linkedin.com/posts/...`, `linkedin.com/pulse/...` e `linkedin.com/embed/feed/update/...`. O status no topo do painel indica o reconhecimento da página.
2. Role a página e carregue manualmente os comentários que deseja incluir na amostra (a régua de cobertura mostrará quanto do total declarado foi capturado).
3. Clique em **Analisar publicação**.
4. Navegue pelas sete abas: Publicação, Engajamento, Sentimentos, Comentários, Motivações, Relatório, Dados brutos.
5. Exporte pelo rodapé nos formatos desejados.

### 4.2 Atualizar coleta

Carregue mais comentários na página e clique em **Atualizar coleta**. As amostras são unidas por ID estável (dedupe por hash de autor + texto), a cobertura é recalculada e classificações de IA já obtidas são preservadas (não se paga duas vezes pela mesma classificação).

### 4.3 Modo IA

1. Abra **Modo IA (opcional)** no rodapé do painel.
2. Marque "Usar IA", escolha o provedor e informe sua chave (`sk-...` para OpenAI, `sk-ant-...` para Anthropic; o formato é validado antes de qualquer envio). O campo Modelo vazio assume o padrão do provedor.
3. Decida sobre "Guardar a chave neste navegador". Desmarcada, a chave vale apenas enquanto o painel estiver aberto.
4. Ao analisar, um diálogo de consentimento lista o que será enviado, o que não será e a finalidade. Cancelar mantém a análise local intacta.
5. Na primeira aceitação, o Chrome pede a permissão de rede para o host do provedor (concessão única).

Resultado do modo IA: tags "IA" nos comentários, sentimentos com rationale contextual, clusters refinados, seção de narrativa no Relatório e `mode: "local+ia"` no export. Em qualquer falha, a análise local é preservada, o erro aparece em destaque no painel e fica registrado no campo `aiStatus` do JSON.

### 4.4 Limpar dados

**Limpar dados** remove o estado persistido (`chrome.storage.local`) e zera o painel. As configurações do modo IA são preservadas.

## 5. Arquitetura

```
┌────────────────────────── Chrome ───────────────────────────┐
│                                                             │
│  Aba do LinkedIn                    Side Panel (panel.html) │
│  ┌──────────────────┐               ┌─────────────────────┐ │
│  │ selectors.js     │   payload     │ panel.js (controle) │ │
│  │ utils.js         │──────────────▶│ analysis.js (local) │ │
│  │ content.js       │  (injeção     │ ai-provider.js      │ │
│  │ (leitura do DOM) │   efêmera)    │ export.js           │ │
│  └──────────────────┘               └──────────┬──────────┘ │
│           ▲                                    │            │
│           │ executeScript                      │ fetch (só  │
│  ┌────────┴─────────┐    mensagens             │ modo IA,   │
│  │ background.js    │◀──────────────────────── │ pós-       │
│  │ (service worker) │  CHECK_PAGE / EXTRACT /  │ consenti-  │
│  │                  │  SAVE/LOAD/CLEAR_STATE   │ mento)     │
│  └────────┬─────────┘                          ▼            │
│           │              chrome.storage   api.anthropic.com │
│           └─────────────▶ .local          api.openai.com    │
└─────────────────────────────────────────────────────────────┘
```

Decisões estruturais:

- **Análise no painel, não no service worker.** O worker MV3 é efêmero; o painel vive enquanto aberto e concentra estado, análise e chamadas de IA. O worker faz apenas validação de página, injeção e persistência.
- **Retorno por valor de injeção.** `content.js` é uma IIFE cuja última expressão é o payload; `executeScript` devolve `results[0].result`, dispensando canal de mensagens do content script.
- **Scripts simples com namespaces globais** (`__LPA_UTILS`, `__LPA_ANALYSIS`, `__LPA_AI`, `__LPA_EXPORT`, `__LPA_SELECTORS`), sem módulos ES: o mesmo `utils.js` roda na página injetada, no painel e nos testes Node (via guarda `module.exports`). Guardas de idempotência permitem reinjeção sem colisão de declarações.

## 6. Inventário de arquivos

| Arquivo | Linhas | Papel |
|---|---|---|
| `manifest.json` | 28 | MV3, permissões mínimas, side panel, hosts de IA opcionais |
| `background.js` | 86 | Service worker: valida URL, injeta leitor, persiste estado |
| `selectors.js` | 196 | Ponto ÚNICO de manutenção de seletores; cascatas por chave |
| `utils.js` | 269 | Funções puras compartilhadas (parsing, idioma, slugs, frases de prova social) |
| `content.js` | 760 | Leitura do DOM com quatro camadas de fallback; devolve RawExtraction |
| `analysis.js` | 582 | Motor local: sentimento, clusters, notas, índices, motivações, relatório |
| `ai-provider.js` | 196 | Camada abstrata de IA; adapters Anthropic e OpenAI; prompts e consentimento |
| `export.js` | 192 | Geração e download de JSON, 2 CSVs, Markdown e HTML |
| `panel.html` | 116 | Estrutura do painel: 7 abas, configurações de IA, diálogo de consentimento |
| `panel.css` | 188 | Design "instrumento analítico"; régua de cobertura como assinatura visual |
| `panel.js` | 545 | Controlador: estados, orquestração, consentimento, renderização, exports |
| `tests/run.js` | 242 | 87 testes em Node puro |
| `tests/CHECKLIST.md` | | 30 cenários de verificação manual |
| `README.md` | | Documentação de entrada |
| `DOCUMENTACAO.md` | | Este documento |

## 7. Camada de extração e estratégias de resiliência

A extração é a parte mais sensível do sistema porque o LinkedIn serve variantes de DOM diferentes por conta e as altera sem aviso. A versão 1.7.1 foi validada em campo na variante mais hostil observada: sem classes semânticas e sem atributos `data-view-name`. As estratégias formam quatro camadas, tentadas em ordem, com registro em `diagnostics.strategiesUsed`:

### Camada 1: seletores em cascata (`selectors.js`)

Cada chave (ex.: `postRoot`, `commentItem`, `reactionsCount`) tem uma lista ordenada de seletores CSS, dos mais semânticos (`[data-urn]`, `[data-view-name="feed-full-update"]`, `aria-label`) aos mais frágeis (classes), com `main` como último recurso para a raiz. A primeira estratégia que encontra elemento vence e seu índice é registrado; falhas vão para `diagnostics.selectorFailures`.

### Camada 2: âncoras de acessibilidade

Independem de classes porque o LinkedIn as mantém por exigência de acessibilidade:

- **Métricas por adjacência** (`U.adjacentCount`): varre `aria-label` e textos curtos exigindo número adjacente à palavra-chave ("11 comentários", "compartilhamentos: 90"), excluindo a área de comentários para não capturar contagens de comentários individuais. `\w` não cobre acentos em JavaScript, então os padrões enumeram as flexões ("reação/reações") explicitamente.
- **Prova social de reações** (`U.reactionsPhraseCount`): "Fulano e mais/outras 676 pessoas" resulta em 677 com `precision: "estimated"` (soma a pessoa nomeada); "90 pessoas reagiram" resulta em 90 `exact`. Cobre pt e en ("and 1.2K others").
- **Comentários por âncora "Responder"** (`structuralComments`): cada comentário possui exatamente um controle Responder/Reply; o contêiner do comentário é o maior ancestral que contém apenas esse controle. As linhas do bloco são então interpretadas (`parseStructuralComment`): tempo por padrão (`^\d+ (min|h|d|sem|...)$`), nome sanitizado de selos colados (`cleanPersonName` remove "Usuário verificado", "Premium", "Perfil", grau de conexão), linhas de metadados ("1 reação", "2 respostas") removidas do corpo e convertidas em contagem, e resumos de reação ("amei 🫶") filtrados. Há um segmentador de defesa para blocos achatados que reconhece o nome pela duplicação típica do cabeçalho (`U.duplicatedPrefix`).
- **Detecção de "carregar mais"**: exige o termo de comentários/respostas no rótulo, para não confundir com o "ver mais" do texto do post.

### Camada 3: estrutura e determinismo

- **Texto do post** (`largestTextBlock`): na ausência de qualquer marcador, o texto é o bloco que concentra o maior volume de texto próprio fora da área de comentários (pontuação por `textContent`, que evita reflow por nó; a extração final usa `innerText` com layout real). O boilerplate de cabeçalho eventualmente arrastado ("Publicação no feed NOME • Seguindo HEADLINE ... 4 d •") é removido por `U.stripFeedBoilerplate`, que de quebra recupera nome, headline e tempo.
- **Autor pelo slug da URL**: `/posts/diegoivo_...` declara o autor de forma determinística. A resolução tenta, em ordem: seletores clássicos; link de perfil cujo `href` corresponda ao slug (links que não correspondem são rejeitados, o que impede capturar o perfil do próprio usuário na caixa de comentar ou na sidebar); cabeçalho no prefixo do texto da raiz; **correspondência de slug** (primeira linha curta cuja normalização `U.slugify` iguala o slug: "Diego Ivo" ↔ `diegoivo`, com suporte a sufixos de ID), colhendo a headline nas linhas seguintes; `og:title`; e URL inferida do slug com aviso explícito quando nenhum link corresponde.
- **Nome de comentarista pelo slug do link** (`U.nameFromProfileSlug`): `/in/mauricio-amaro/` vira "Mauricio Amaro". Slugs de token único (`/in/fabiosp`) retornam nulo por decisão: nunca inventar nomes a partir de handles opacos.
- **ID do post**: URN na URL ou no DOM; em URLs `/posts/`, extraído do slug (`-share-7487463887773270016-`).
- **Menções sem `@`**: no DOM novo as menções são nomes puros em links; todo link de perfil cujo texto apareça no corpo do comentário é registrado como menção, alimentando o flag `mentionOnly` e o cluster "marcação de outras pessoas".

### Camada 4: degradação honesta

Campo não encontrado vira `available: false`; a extração nunca aborta por falha parcial. Se nem a raiz for encontrada, o erro retorna com uma **sonda** (contagem de elementos conhecidos na página, `readyState`, inventário de `data-view-name`) exibida na própria mensagem, transformando cada falha em insumo de manutenção.

### Nota técnica: leitura de texto com layout

`innerText` em nó clonado fora do documento degrada para `textContent` (perde quebras de linha), e `visibility: hidden` faz o Chrome excluir o conteúdo do `innerText`. Por isso `textOf` anexa o clone **renderizado** fora da viewport (`position: fixed; left: -100000px`, sem esconder) durante a leitura, remove elementos de interface (botões, textos de acessibilidade) e devolve texto com as linhas reais. Esse detalhe é pré-requisito de todo o parser de comentários por linhas.

## 8. Motor de análise local

Pipeline (`__LPA_ANALYSIS.analyze(raw, previousComments?)`):

1. **Preparação**: dedupe por hash (autor + prefixo do texto), flags `emojiOnly`, `mentionOnly` (com remoção literal das menções, cobrindo nomes sem `@`), `genericOnly` (regex de frases-clichê pt/en). No refresh, `mergeComments` une por ID preservando classificações com `source: "ai"`.
2. **Idioma**: heurística por stopwords pt/en (`pt`, `en` ou `unknown`).
3. **Sentimento por comentário** (`sentimentOf`): léxicos embutidos pt/en (~200 termos), negação por token anterior, emojis polares com peso 0.5, ramo dedicado para emoji-only, detecção de risco de ironia (kkk, aspas, "claro que sim") que rebaixa a confiança e pode converter o rótulo em `indeterminado`. Saída: `{label, emotion, intensity, confidence, rationale, source: "rules"}` com 15 emoções mapeadas por padrões.
4. **Clusters por comentário** (`clustersOf`): 19 categorias comportamentais por regras (agradecimento, elogio, marcação, experiência pessoal, concordância, discordância, crítica, dúvida, pedido de material, complemento técnico, recomendação, networking, autopromoção, humor, relato de resultado, intenção de uso, defesa do autor, conversa paralela, comentário genérico). Um comentário pode pertencer a até 3.
5. **Notas do post** (`scorePost`): 15 critérios 0-10 (gancho, clareza, leitura, utilidade, originalidade, profundidade, credibilidade, autoridade, identificação, debate, compartilhamento, CTA, promessa, relevância, densidade), cada um com fórmula heurística baseada em características mensuráveis do texto e `rationale` explícita. São heurísticas de estrutura, não medidas de qualidade real, e a interface repete esse aviso.
6. **Gancho** (`analyzeHook`): classificação em 14 mecanismos (número/dado, pergunta, curiosidade, benefício, controvérsia, história pessoal, dor, medo de perda, oportunidade, autoridade, notícia, quebra de expectativa, identificação, indeterminado), por que interrompe a rolagem, expectativa criada vs. entregue (hipótese), lacuna de curiosidade e dependência da reputação do autor (hipóteses).
7. **Agregações** (`aggregate`): distribuições de sentimento e emoção; clusters com contagem, percentual, intensidade média e exemplos; top de discussões; taxas de qualidade com fórmulas declaradas (genéricos, conversação, contribuição, intenção, profundidade média); classificação do engajamento em superficial, relacional, informacional, emocional, conversacional, crítico ou comercial.
8. **Índices 0-100** (`indices`): 8 índices (identificação, utilidade percebida, força emocional, força conversacional, compartilhamento, autoridade, profundidade do debate, qualidade geral), cada um com fórmula publicada e o disclaimer de que não são métricas oficiais.
9. **Motivações** (`motivations`): hipóteses por tipo de engajamento, cada uma com evidência quantificada extraída dos clusters/emoções e força (fraca, média, forte), mais um disclaimer global de que motivações não são observáveis nas métricas.
10. **Relatório** (`buildReport`): resumo executivo, as 8 perguntas diagnósticas, evidências, recomendações (replicáveis, não copiar literalmente, melhorias, estrutura sugerida, riscos de interpretação, aprofundamentos) e nota de cobertura.
11. **Temas** (`themes`): frequência ponderada de termos (post ×3, hashtags ×5, comentários ×1), com URLs removidas e stopwords de infraestrutura, declarando o método como aproximação lexical.

## 9. Modo IA

### 9.1 Contrato de provider (`ai-provider.js`)

```js
{ id, label, defaultModel, endpointHost, docs,
  buildRequest(model, apiKey, prompt) -> { url, options },
  parseResponse(json) -> string }
```

Adapters incluídos:

| Provider | Endpoint | Modelo padrão | Particularidades |
|---|---|---|---|
| `anthropic` | `api.anthropic.com/v1/messages` | `claude-sonnet-4-6` | Headers `x-api-key`, `anthropic-version: 2023-06-01` e `anthropic-dangerous-direct-browser-access: true` (exigido para chamadas diretas do navegador) |
| `openai` | `api.openai.com/v1/chat/completions` | `gpt-5-mini` | `Authorization: Bearer`. O padrão foi migrado de `gpt-4o-mini` após a aposentadoria da série 4 em 2026 |

Para adicionar um provedor, basta um novo objeto no mapa `PROVIDERS` e uma `<option>` no `panel.html`.

### 9.2 Tarefas

- **`classifyComments`**: lotes de até 60 comentários (texto truncado em 400 caracteres; post em 1.500), prompt exige JSON puro com listas fechadas de sentimentos, emoções e clusters e instrui "indeterminado" quando o contexto não permite segurança. A resposta é validada campo a campo contra as listas; valores fora delas são descartados. Saída: mapa `id -> {sentiment(source:"ai"), clusters}`.
- **`narrativeReport`**: JSON com `narrative`, `whyLikes`, `whyComments`, `whyShares`, `needServed`, `replicable`, `contextDependent`, `risks`. O prompt impõe a convenção epistêmica ("Os dados mostram...", "Uma hipótese plausível é...").

Após a classificação, o painel reagrega tudo (distribuições, índices, motivações, relatório) sobre os rótulos da IA e marca `mode: "local+ia"`.

### 9.3 Fluxo de segurança

1. Validação de formato da chave por provedor (`sk-` / `sk-ant-`), antes de qualquer diálogo.
2. Diálogo de consentimento por análise: serviço, modelo, dados enviados (textos truncados e métricas agregadas), dados não enviados (cookies, credenciais, URLs de perfil) e finalidade.
3. `chrome.permissions.request` para o host do provedor (permissão opcional do manifest, concedida uma única vez).
4. Execução com progresso por lote; em qualquer falha, resultados locais preservados, erro em destaque no painel e registrado em `aiStatus`.

Validação em campo (2026-08-03): ambos os adapters aprovados de ponta a ponta no mesmo post real; o caso de prova "é uma mãe 🫶🙏" foi classificado contextualmente pelos dois (Claude: gratidão, confiança 0.85; GPT: admiração, 0.9), ilustrando a variação legítima entre modelos que o campo `confidence` existe para expor.

## 10. Modelo de dados

Estrutura do JSON completo (campos ilustrativos):

```jsonc
{
  "exportVersion": "1.7.1",
  "collectedAt": "2026-08-03T12:20:00.000Z",
  "mode": "local | local+ia",
  "aiStatus": { "attempted": true, "ok": true, "provider": "openai",
                "model": "gpt-5-mini", "error": null },   // null se IA desativada
  "coverage": { "commentsLoaded": 12, "commentsDeclared": 13,
                "ratio": 0.923, "complete": false, "moreAvailableInPage": false },
  "raw": {
    "meta": { "url", "postId", "collectedAt", "pageTitle" },
    "post": {
      "type": "text|image|video|document|poll|article|repost",
      "mediaDetected": [],
      "author": { "name", "profileUrl", "headline", "connectionDegree",
                  "followers": { "raw", "normalized", "precision", "available" },
                  "verified" },
      "content": { "fullText", "hookText", "truncatedInDom",
                   "stats": { "chars", "words", "paragraphs", "lines" },
                   "hashtags", "mentions", "links", "emojis",
                   "mediaAltTexts", "cta": { "present", "type" } },
      "repost": null
    },
    "metrics": {
      "reactions": { "raw": "e mais 676 pessoas", "normalized": 677,
                     "precision": "estimated", "available": true },
      "comments": {}, "reposts": {}, "views": {},
      "byType": { "gostei": { "present": true, "count": { "available": false } } }
    },
    "comments": [ { "id", "parentId", "level", "author": { "name", "headline", "profileUrl" },
                    "text", "timeLabel", "reactions", "repliesCount",
                    "flags": { "byPostAuthor", "highlighted" },
                    "links", "mentions", "hashtags", "emojis" } ],
    "diagnostics": { "strategiesUsed", "selectorFailures", "warnings", "viewNames" }
  },
  "analysis": {
    "language": "pt",
    "comments": [ { "...raw", "textNormalized",
                    "flags": { "+emojiOnly", "+mentionOnly", "+genericOnly" },
                    "sentiment": { "label", "emotion", "intensity", "confidence",
                                   "rationale", "source": "rules|ai" },
                    "clusters": [], "clustersSource": "rules|ai" } ],
    "scores":      { "<critério>": { "score": 0-10, "rationale", "kind": "heuristic" } },
    "hook":        { "categories", "whyItStopsScroll", "expectationCreated",
                     "expectationDelivered": { "value", "kind": "hypothesis", "note" },
                     "curiosityGap", "dependsOnAuthorReputation" },
    "themes":      { "main", "secondary", "method" },
    "aggregates":  { "sentimentDist", "emotionDist", "clusters",
                     "topDiscussion", "quality", "engagementClass", "totalAnalyzed" },
    "indices":     { "<índice>": { "value": 0-100, "methodology", "kind": "heuristic" } },
    "motivations": { "reactions|comments|shares":
                       [ { "hypothesis", "evidence", "strength", "kind": "hypothesis" } ],
                     "disclaimer" },
    "report":      { "summary", "diagnosis", "evidence", "recommendations", "coverageNote" },
    "aiNarrative": { "narrative", "whyLikes", "whyComments", "whyShares",
                     "needServed", "replicable", "contextDependent", "risks" }  // só modo IA
  },
  "diagnostics": { }   // espelho de raw.diagnostics
}
```

Convenções transversais: números como `{raw, normalized, precision, available}`; interpretações com `kind` e, quando aplicável, `confidence`; nada de zeros inventados; hierarquia de comentários por `level` (0-2) e `parentId`.

## 11. Exportações

Todos os artefatos são gerados localmente via Blob; nada passa por servidor. O nome-base é `lpa_<postId>_<data>`.

| Botão | Arquivo | Conteúdo |
|---|---|---|
| JSON completo | `.json` | O modelo da seção 10, íntegro, incluindo brutos, análises, diagnósticos e `aiStatus` |
| CSV comentários | `_comentarios.csv` | 21 colunas por comentário: hierarquia, autor, texto, flags, sentimento, emoção, intensidade, confiança, clusters, fonte da classificação. BOM UTF-8 para acentuação correta no Excel |
| CSV métricas | `_metricas.csv` | Métricas com valor exibido/normalizado/precisão, cobertura e os 8 índices |
| Relatório .md | `_relatorio.md` | Relatório completo: resumo executivo, métricas, notas, gancho, sentimentos, qualidade com fórmulas, índices com metodologia, diagnóstico, seção de IA quando houver, recomendações |
| Relatório .html | `_relatorio.html` | O mesmo relatório com conversor MD→HTML próprio e estilo embutido, legível standalone |

## 12. Permissões, privacidade e segurança

| Permissão | Justificativa |
|---|---|
| `activeTab` | Ler a aba visível apenas quando o usuário aciona |
| `scripting` | Injeção efêmera do leitor (sem content script permanente) |
| `storage` | Última análise e configurações |
| `sidePanel` | Interface |
| host `https://www.linkedin.com/*` | Escopo da injeção restrito ao LinkedIn |
| opcionais `api.anthropic.com`, `api.openai.com` | Solicitadas em runtime somente se o usuário ativar IA e consentir |

Tratamento da chave de API: fornecida pelo usuário, nunca embutida, enviada exclusivamente ao provedor escolhido como autenticação. Persistência opcional em `chrome.storage.local` com codificação base64, que é **ofuscação, não criptografia** (o Chrome não oferece cofre de segredos a extensões); a interface avisa e oferece o modo sessão. Dados enviados no modo IA: texto do post (truncado em 3.000 caracteres), textos dos comentários (400 cada) e métricas agregadas. Nunca enviados: cookies, credenciais, URLs de perfil.

Superfícies de risco conhecidas e mitigação: toda renderização de dados extraídos passa por `escapeHtml` (conteúdo de terceiros no DOM do LinkedIn é tratado como hostil); CSVs escapam separadores e aspas; o conversor HTML escapa antes de aplicar marcação.

## 13. Observabilidade e diagnóstico

Ferramentas embutidas, todas presentes no JSON exportado:

- **`diagnostics.strategiesUsed`**: por chave, o índice da estratégia de seletor vencedora ou o nome do fallback (`fallback-reply-anchors`, `fallback-largest-block+strip-header`, `slug-name-match`, `fallback-social-proof`, `fallback-aria`, `header-prefix`, `og-title`...). É o mapa de quão degradada está a extração naquela variante de DOM.
- **`diagnostics.selectorFailures`**: chaves cuja cascata inteira falhou. Cinco ou mais falhas disparam no painel o aviso de "DOM em formato novo" com o inventário de componentes.
- **`diagnostics.viewNames`**: censo de todos os valores `data-view-name` da página, para calibrar seletores quando esse mecanismo existir.
- **`diagnostics.warnings`**: truncamento de texto, uso de heurísticas estruturais, URLs inferidas e afins, replicados no painel.
- **Sonda de `POST_NOT_FOUND`**: quando nem a raiz é encontrada, a mensagem de erro traz `readyState` e a contagem de elementos conhecidos presentes.
- **`aiStatus`**: `{attempted, ok, provider, model, error}` de cada tentativa de IA, exibido em destaque no painel quando falha e persistido no export.

Roteiro de diagnóstico recomendado: reproduzir, exportar o JSON, ler `selectorFailures` e `strategiesUsed`, comparar com `viewNames`/sonda, e ajustar a cascata correspondente em `selectors.js` (camada 1) ou o fallback pertinente em `content.js` (camadas 2-3).

## 14. Testes

### 14.1 Automatizados

`node tests/run.js` executa 87 asserções em Node puro, sem dependências, cobrindo as funções puras:

- `parseCount` e `parseCountFromText`: "1,2 mil" → 1200 abbreviated, "1.234" → 1234 exact, "1.2K", "3 mi", vazios e nulos.
- Texto: limpeza de invisíveis, hashtags, URLs (incluindo emoji colado e pontuação final), emoji-only, idioma, parágrafos, hash estável, CSV.
- `stripFeedBoilerplate`: fixtures reais pt e en, incluindo o caso que não deve remover nada.
- `adjacentCount`: adjacência nas duas ordens, abreviados, rejeição de "2º grau".
- `duplicatedPrefix`, `slugify`, `nameFromProfileSlug` (incluindo o token único que deve retornar nulo).
- `reactionsPhraseCount`: "e outras/e mais N" com +1 estimated, "N pessoas reagiram" exact, variante en, frase sem contagem.
- Análise: dedupe, flags, sentimento (positivo, negativo, pergunta neutra com curiosidade, emoji-only, rebaixamento por ironia), clusters (agradecimento, pedido de material sem virar dúvida, marcação, experiência), `mentionOnly` sem `@`, temas ignorando URLs, merge preservando classificações de IA.
- Pipeline completo sobre fixture: 15 notas com rationale, 8 índices com metodologia e disclaimer, 8 perguntas do diagnóstico, gancho, cobertura parcial sinalizada, motivações como hipóteses com evidência.

### 14.2 Manuais

`tests/CHECKLIST.md` lista 30 cenários: detecção de página (4), tipos de publicação (7), métricas e cobertura (5), análise (4), modo IA (6), persistência e exportação (3), robustez a quebra de seletor (1). Os cenários de IA (21-26) e o núcleo de extração foram executados em campo durante a estabilização.

## 15. Guia de manutenção

**Quando o LinkedIn mudar o DOM** (sintoma: campos indisponíveis, avisos de heurística estrutural ou `POST_NOT_FOUND`):

1. Exporte o JSON e leia `diagnostics` (seção 13).
2. Se um mecanismo novo de marcação existir (ex.: `viewNames` populado), adicione estratégias no TOPO das cascatas em `selectors.js`. Este arquivo é o único ponto de manutenção de seletores; não espalhe seletores por outros arquivos.
3. Se a mudança for estrutural, ajuste o fallback correspondente em `content.js`, mantendo o registro em `strategiesUsed` e o aviso ao usuário.
4. Rode `node tests/run.js`; adicione fixture do caso novo quando a lógica for pura.
5. Incremente a versão no `manifest.json` e a constante `VERSION` em `export.js`.

**Para adicionar um provedor de IA**: novo objeto em `PROVIDERS` (`ai-provider.js`) seguindo o contrato da seção 9.1, `<option>` no select do `panel.html`, host em `optional_host_permissions` no manifest e, se o formato de chave tiver prefixo conhecido, a validação em `panel.js`.

**Para adicionar cluster ou emoção**: inclua o par nome/regra em `CLUSTER_RULES` ou `EMOTION_PATTERNS` (`analysis.js`) e o mesmo nome nas listas fechadas dos prompts (`ai-provider.js`), mantendo os dois modos consistentes.

**Invariantes a preservar em qualquer mudança**: leitura passiva; nenhum número inventado; `precision`/`kind`/`confidence` em tudo; consentimento antes de qualquer envio; falha parcial nunca aborta a extração; erro de IA nunca destrói o resultado local.

## 16. Limitações conhecidas

- **Amostra**: restrita ao que está no DOM. A contagem declarada pode divergir da soma visível (comentários removidos, filtro de relevância). Toda conclusão carrega a nota de cobertura.
- **Hierarquia de respostas**: no modo estrutural (DOM sem marcadores), os níveis podem vir achatados (tudo nível 0); o painel avisa.
- **Nomes de comentaristas**: slugs de perfil de token único não são convertidos em nome (decisão de nunca inventar); esses autores ficam nulos quando o texto do link também falha.
- **Reações por tipo**: o LinkedIn não expõe contagens por tipo nesta visão; registra-se apenas a presença dos ícones.
- **Sentimento local**: léxico com negação simples; ironia e contexto longo têm precisão limitada, refletida na confiança. O modo IA melhora, mas modelos diferentes divergem legitimamente em casos ambíguos.
- **Notas e índices**: heurísticas de estrutura com fórmulas publicadas; correlação não é causalidade.
- **Datas**: preserva-se o rótulo relativo do LinkedIn ("4 d"), sem conversão a data absoluta.
- **Idiomas**: heurísticas calibradas para português e inglês.
- **Headline do autor**: pode ficar indisponível em layouts onde o cabeçalho não a expõe próximo ao nome.

## 17. Histórico de versões

| Versão | Data | Mudanças principais |
|---|---|---|
| 1.0.0 | 2026-07-31 | Entrega inicial: MV3 + side panel, extração para o DOM clássico, motor local completo (sentimento, 19 clusters, 15 notas, 8 índices, motivações, relatório), modo IA (Anthropic e OpenAI) com consentimento e permissões opcionais, 4 formatos de exportação, 56 testes. Ajustes imediatos: cascata `postRoot` ampliada, fallback por âncora e sonda de diagnóstico no erro. |
| 1.2.0 | 2026-08-01 | Suporte ao DOM novo: estratégias `data-view-name`, fallbacks estruturais (autor por link, bloco de texto dominante, métricas por `aria-label`), comentários por âncora "Responder", `stripFeedBoilerplate`, `adjacentCount`, inventário `viewNames`, charset de URL, `postId` por slug. 70 testes. |
| 1.3.0 | 2026-08-02 | Leitura de texto com layout real (correção definitiva das quebras de linha), autor validado por slug com rejeição de links não correspondentes, `og:title`, URL inferida com aviso, cobertura completa pela contagem declarada, "carregar mais" exigindo termo de comentários, segmentador de blocos achatados com `duplicatedPrefix`, `verified` restrito ao contêiner do autor. 73 testes. |
| 1.4.0 | 2026-08-02 | `cleanPersonName` (selos colados), metadados "N reações/respostas" fora do corpo e convertidos em contagem, menções sem `@` via links (`mentionOnly` correto), temas ignorando URLs, `reactionsPhraseCount` (prova social). 80 testes. |
| 1.5.0 | 2026-08-02 | Autor por correspondência determinística de slug no texto (`slug-name-match`), variante "e mais N" no ramo +1 com `raw` limpo, `nameFromProfileSlug` para comentaristas. 87 testes. |
| 1.6.0 | 2026-08-02 | Correção do filtro de metadados para acentos (`\w` não casa "reação"), colheita da headline nas linhas após o nome do autor. |
| 1.7.0 | 2026-08-03 | Observabilidade do modo IA: campo `aiStatus` persistido e exportado, erro de IA em destaque no bloco consolidado de avisos; modelo padrão OpenAI migrado para `gpt-5-mini` após a aposentadoria da série 4. |
| 1.7.1 | 2026-08-03 | Validação de formato de chave por provedor antes do consentimento. Versão validada em campo com os dois adapters de IA aprovados de ponta a ponta. |

## 18. Aviso de responsabilidade

A extensão automatiza apenas a leitura do que o próprio usuário já vê, sem coleta em massa, sem burlar autenticação e sem interações automáticas. Ainda assim, os Termos de Serviço do LinkedIn impõem restrições a ferramentas de terceiros e à extração de dados; a avaliação de conformidade e o uso são de responsabilidade do usuário. Recomenda-se uso moderado, em publicações individuais, para fins analíticos próprios. Os dados extraídos podem conter dados pessoais de terceiros (nomes, comentários, headlines); trate as exportações conforme a LGPD/GDPR aplicável ao seu contexto. As chamadas do modo IA transferem textos aos provedores escolhidos sob os termos e políticas de privacidade desses provedores.
