# LinkedIn Post Analyzer (LPA)

Extensão Chrome (Manifest V3) que lê a publicação do LinkedIn aberta na aba atual e produz uma análise estruturada: dados do post e do autor, métricas de engajamento, comentários com hierarquia, sentimento, clusters comportamentais, hipóteses de motivação, índices analíticos e relatório exportável.

Princípio central: a extensão só lê o que já está visível no DOM, sob demanda, e diferencia explicitamente dado observado de hipótese interpretativa.

## Instalação (sem loja)

1. Baixe/extraia esta pasta.
2. Abra `chrome://extensions`.
3. Ative o "Modo do desenvolvedor" (canto superior direito).
4. Clique em "Carregar sem compactação" e selecione a pasta do projeto.
5. Fixe o ícone da extensão. Clicar nele abre o painel lateral.

Requisito: Chrome 116+ (API de side panel).

## Uso

1. Abra uma publicação específica do LinkedIn (`/feed/update/urn:li:activity:...` ou `/posts/...`).
2. Role a página e carregue manualmente os comentários que quer incluir na amostra. A extensão nunca clica nem carrega nada por conta própria.
3. Clique em "Analisar publicação".
4. Se quiser ampliar a amostra depois, carregue mais comentários na página e use "Atualizar coleta": as amostras são unidas e a cobertura recalculada.
5. Exporte pelo rodapé: JSON completo, CSV de comentários, CSV de métricas, relatório em Markdown ou HTML.

## Arquitetura

```
manifest.json     MV3, permissões mínimas, side panel
background.js     service worker: valida a aba, injeta o leitor, persiste estado
selectors.js      ÚNICO ponto de manutenção dos seletores (cascatas por chave)
utils.js          funções puras (parsing de números, idioma, texto); usadas na página, no painel e nos testes
content.js        leitura do DOM -> payload bruto (RawExtraction); nenhuma análise
analysis.js       motor local por regras: sentimento, clusters, notas, índices, motivações, relatório
ai-provider.js    camada abstrata de IA (Anthropic e OpenAI) para o modo opcional
export.js         geração de JSON/CSV/MD/HTML locais
panel.html/css/js interface do painel lateral (7 abas), consentimento e configurações
tests/run.js      testes automatizados em Node puro
tests/CHECKLIST.md roteiro de testes manuais
```

Fluxo: painel envia `EXTRACT` ao service worker, que injeta `selectors.js + utils.js + content.js` na aba ativa via `chrome.scripting.executeScript`. O retorno da injeção é o payload bruto. Toda a análise roda no painel. O estado fica em `chrome.storage.local` e sobrevive ao fechamento do painel até "Limpar dados".

## Permissões e justificativas

| Permissão | Uso |
|---|---|
| `activeTab` | Ler a aba que o usuário está vendo, apenas quando ele aciona a análise |
| `scripting` | Injetar o leitor de DOM sob demanda (não há content script permanente) |
| `storage` | Persistir a última análise e as configurações |
| `sidePanel` | Interface no painel lateral |
| host `www.linkedin.com` | Escopo da injeção restrito ao LinkedIn |
| opcionais `api.anthropic.com`, `api.openai.com` | Solicitadas em tempo de execução somente se o usuário ativar o modo IA e consentir |

Não há telemetria, analytics, código remoto nem CDNs. No modo local, nenhum byte sai do navegador.

## Modelo de dados (resumo do JSON exportado)

```jsonc
{
  "exportVersion": "1.0.0",
  "coverage": { "commentsLoaded": 41, "commentsDeclared": 128, "ratio": 0.32, "complete": false },
  "mode": "local",            // ou "local+ia"
  "raw": {
    "meta": { "url", "postId", "collectedAt" },
    "post": {
      "type": "text|image|video|document|poll|article|repost",
      "author": { "name", "headline", "profileUrl", "followers": {"raw","normalized","precision","available"}, "verified" },
      "content": { "fullText", "hookText", "truncatedInDom", "stats", "hashtags", "mentions", "links", "emojis", "cta" },
      "repost": null
    },
    "metrics": {
      "reactions": { "raw": "1,2 mil", "normalized": 1200, "precision": "abbreviated", "available": true },
      "comments": { ... }, "reposts": { ... }, "views": { ... },
      "byType": { "gostei": { "present": true, "count": { "available": false } } }
    },
    "comments": [ { "id", "parentId", "level", "author", "text", "reactions", "flags" } ],
    "diagnostics": { "strategiesUsed", "selectorFailures", "warnings" }
  },
  "analysis": {
    "scores":      { "força do gancho": { "score": 7.5, "rationale": "...", "kind": "heuristic" }, ... },
    "hook":        { "categories", "whyItStopsScroll", "expectationDelivered": { "kind": "hypothesis" } },
    "comments":    [ { "sentiment": { "label", "emotion", "intensity", "confidence", "rationale", "source": "rules|ai" }, "clusters": [] } ],
    "aggregates":  { "sentimentDist", "emotionDist", "clusters", "quality", "engagementClass" },
    "indices":     { "qualidade geral do engajamento": { "value": 62, "methodology": "..." }, ... },
    "motivations": { "reactions|comments|shares": [ { "hypothesis", "evidence", "strength", "kind": "hypothesis" } ] },
    "report":      { "summary", "diagnosis", "recommendations", "coverageNote" }
  }
}
```

Convenções de honestidade dos dados:
- Todo número tem `precision`: `exact`, `abbreviated` (ex.: "1,2 mil" vira 1200), `estimated` ou `unavailable`. Valor não visível nunca vira 0.
- Todo bloco interpretativo tem `kind: "observation" | "hypothesis" | "heuristic"` e, quando aplicável, `confidence`.
- Índices 0-100 são criados pela extensão, com fórmula explícita, e não são métricas oficiais do LinkedIn.
- A cobertura da amostra acompanha todas as conclusões: análises valem apenas para os comentários efetivamente coletados.

## Modo IA (opcional)

- Desativado por padrão. O usuário informa a própria chave (Anthropic ou OpenAI) no painel.
- Antes de cada análise com IA, um diálogo de consentimento lista exatamente o que será enviado (texto do post truncado, textos dos comentários truncados, métricas agregadas), o que não será enviado (cookies, credenciais, URLs de perfil) e a finalidade.
- A permissão de rede para o host do provedor é solicitada ao Chrome apenas nesse momento (`optional_host_permissions`).
- A chave pode valer só para a sessão do painel ou ser guardada em `chrome.storage.local`. Atenção: esse armazenamento é ofuscado (base64), não criptografado; o Chrome não oferece cofre de segredos para extensões. Prefira a opção de sessão em máquinas compartilhadas.
- Modelos padrão: `claude-sonnet-4-6` (Anthropic) e `gpt-5-mini` (OpenAI), ambos editáveis. Referências: https://docs.claude.com/en/api/overview e https://platform.openai.com/docs
- Se a chamada falhar (chave inválida, rede, permissão negada), a análise local é mantida e o erro é exibido de forma legível.

## Testes

Automatizados (funções puras):

```bash
node tests/run.js
```

Cobrem parsing de números pt/en, detecção de idioma, deduplicação, sentimento (incluindo emoji-only e rebaixamento por ironia), clusters, merge de coletas com preservação de classificações de IA e o pipeline completo com uma fixture de publicação. Roteiro manual em `tests/CHECKLIST.md` (30 cenários).

## Robustez a mudanças do LinkedIn

O DOM do LinkedIn muda com frequência. Mitigações:
- Todos os seletores vivem em `selectors.js`, cada chave com uma cascata de estratégias (atributos semânticos primeiro, classes por último).
- A estratégia usada por chave e as falhas ficam registradas em `diagnostics` no JSON exportado, o que acelera o diagnóstico quando algo quebrar.
- Campo não encontrado vira `available: false`; a extração nunca aborta por falha parcial.

Quando algo quebrar: exporte o JSON, veja `diagnostics.selectorFailures`, inspecione o novo DOM e adicione uma estratégia no topo da cascata correspondente.

## Limitações conhecidas

- Amostra: só o que está carregado no DOM. Contagens declaradas pelo LinkedIn podem divergir da soma visível (comentários removidos, filtro de relevância).
- Distribuição de reações por tipo: o LinkedIn não expõe contagens por tipo nessa visão; a extensão registra apenas quais tipos aparecem.
- Sentimento no modo local usa léxico pt/en com negação simples; ironia, sarcasmo e contexto longo têm precisão limitada (a confiança reportada reflete isso). O modo IA melhora, mas não elimina, esse limite.
- Notas 0-10 e índices 0-100 são heurísticas de estrutura, não medidas causais de qualidade. Correlação não é causalidade.
- Datas: o LinkedIn exibe tempo relativo ("2 sem"); a extensão preserva o rótulo, sem converter em data absoluta.
- Idiomas: heurísticas calibradas para português e inglês.

## Aviso de responsabilidade

Esta extensão automatiza apenas a leitura do que o próprio usuário já está vendo, sem coleta em massa, sem burlar autenticação e sem interações automáticas. Ainda assim, os Termos de Serviço do LinkedIn impõem restrições a ferramentas de terceiros e a extração de dados; a avaliação de conformidade e o uso são de responsabilidade do usuário. Use com moderação, em posts individuais, para fins analíticos próprios. Os dados extraídos podem conter dados pessoais de terceiros (nomes, comentários): trate exportações de acordo com a LGPD/GDPR aplicável ao seu contexto.

## Sugestões de evolução

- Comparação entre múltiplas publicações salvas (benchmark do próprio autor).
- Detecção de idioma por comentário (hoje é global).
- Suporte a mais provedores de IA via novo adapter em `ai-provider.js` (contrato documentado no arquivo).
- Léxicos de sentimento expandidos ou embeddings locais (WebGPU) para clusterização semântica sem rede.
- Snapshot de seletores com testes de regressão contra HTML fixtures gravados.
