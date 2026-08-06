/**
 * ai-provider.js
 * Camada abstrata de provedores de IA para o MODO IA (opcional).
 *
 * Contrato Provider:
 *   { id, label, defaultModel, endpointHost, buildRequest(model, apiKey, prompt) -> {url, options}, parseResponse(json) -> string }
 *
 * Regras de privacidade (aplicadas no panel.js, reforçadas aqui):
 *  - NENHUMA chamada externa ocorre sem consentimento explícito por análise.
 *  - A chave vem do usuário; nunca é embutida no código nem enviada a outro destino.
 *  - Somente o texto do post e dos comentários é enviado; nunca cookies, tokens ou URLs de perfil.
 */
(function () {
  if (globalThis.__LPA_AI) return;
  const U = globalThis.__LPA_UTILS;

  const PROVIDERS = {
    anthropic: {
      id: 'anthropic',
      label: 'Anthropic (Claude)',
      defaultModel: 'claude-sonnet-4-6',
      endpointHost: 'https://api.anthropic.com',
      docs: 'https://docs.claude.com/en/api/overview',
      buildRequest(model, apiKey, prompt) {
        return {
          url: 'https://api.anthropic.com/v1/messages',
          options: {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              // Necessário para chamadas diretas do navegador (CORS):
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model,
              max_tokens: 4096,
              messages: [{ role: 'user', content: prompt }]
            })
          }
        };
      },
      parseResponse(json) {
        if (json.error) throw new Error(json.error.message || 'Erro da API Anthropic');
        return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      }
    },

    openai: {
      id: 'openai',
      label: 'OpenAI',
      defaultModel: 'gpt-5-mini',
      endpointHost: 'https://api.openai.com',
      docs: 'https://platform.openai.com/docs',
      buildRequest(model, apiKey, prompt) {
        return {
          url: 'https://api.openai.com/v1/chat/completions',
          options: {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }]
            })
          }
        };
      },
      parseResponse(json) {
        if (json.error) throw new Error(json.error.message || 'Erro da API OpenAI');
        return json.choices && json.choices[0] ? json.choices[0].message.content : '';
      }
    }
  };

  async function call(providerId, model, apiKey, prompt) {
    const p = PROVIDERS[providerId];
    if (!p) throw new Error('Provedor desconhecido: ' + providerId);
    const { url, options } = p.buildRequest(model || p.defaultModel, apiKey, prompt);
    const res = await fetch(url, options);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json.error && json.error.message) || res.status + ' ' + res.statusText;
      throw new Error('Falha na chamada de IA: ' + msg);
    }
    return p.parseResponse(json);
  }

  function extractJson(text) {
    const cleaned = String(text || '').replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf(cleaned[0] === '[' ? '[' : '{');
    try { return JSON.parse(cleaned); } catch (e) { /* tenta recorte */ }
    const s = Math.min(...['{', '['].map(ch => { const i = cleaned.indexOf(ch); return i === -1 ? Infinity : i; }));
    const eIdx = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (s === Infinity || eIdx === -1) throw new Error('Resposta da IA não contém JSON válido.');
    return JSON.parse(cleaned.slice(s, eIdx + 1));
  }

  // -------------------------------------------------------------------- tarefas

  const SENTIMENTS = ['positivo', 'neutro', 'negativo', 'misto', 'indeterminado'];
  const EMOTIONS = ['gratidão', 'entusiasmo', 'admiração', 'identificação', 'curiosidade', 'surpresa', 'concordância', 'discordância', 'crítica', 'frustração', 'humor', 'apoio', 'celebração', 'dúvida', 'ceticismo'];
  const CLUSTERS = ['agradecimento', 'elogio', 'marcação de outras pessoas', 'experiência pessoal', 'concordância', 'discordância', 'crítica', 'dúvida', 'pedido de material', 'complemento técnico', 'recomendação', 'networking', 'autopromoção', 'humor', 'relato de resultado', 'intenção de uso', 'defesa do autor', 'conversa paralela', 'comentário genérico'];

  /**
   * Classifica sentimento + clusters dos comentários em lotes.
   * Retorna mapa id -> { sentiment, clusters }.
   */
  async function classifyComments(cfg, postText, comments, onProgress) {
    const BATCH = 60;
    const result = new Map();
    for (let i = 0; i < comments.length; i += BATCH) {
      const batch = comments.slice(i, i + BATCH);
      const items = batch.map(c => ({ id: c.id, level: c.level, byPostAuthor: !!c.flags.byPostAuthor, text: (c.text || '').slice(0, 400) }));
      const prompt =
`Você é um analisador de engajamento do LinkedIn. Contexto (post, truncado):
"""${(postText || '').slice(0, 1500)}"""

Classifique cada comentário abaixo considerando contexto, ironia e emojis.
Sentimentos permitidos: ${SENTIMENTS.join(', ')}.
Emoções permitidas (ou null): ${EMOTIONS.join(', ')}.
Categorias comportamentais permitidas (1 a 3 por comentário): ${CLUSTERS.join('; ')}.
Se o contexto não permitir classificação segura, use "indeterminado" com confiança baixa. Não invente precisão.

Comentários: ${JSON.stringify(items)}

Responda APENAS com JSON válido, sem markdown, no formato:
[{"id":"...","sentiment":"...","emotion":"...|null","intensity":0.0,"confidence":0.0,"rationale":"curta","clusters":["..."]}]`;

      const text = await call(cfg.provider, cfg.model, cfg.apiKey, prompt);
      const arr = extractJson(text);
      for (const r of arr) {
        if (!r || !r.id) continue;
        result.set(r.id, {
          sentiment: {
            label: SENTIMENTS.includes(r.sentiment) ? r.sentiment : 'indeterminado',
            emotion: EMOTIONS.includes(r.emotion) ? r.emotion : null,
            intensity: U.clamp(Number(r.intensity) || 0, 0, 1),
            confidence: U.clamp(Number(r.confidence) || 0, 0, 1),
            rationale: String(r.rationale || '').slice(0, 300),
            source: 'ai'
          },
          clusters: Array.isArray(r.clusters) ? r.clusters.filter(c => CLUSTERS.includes(c)).slice(0, 3) : null
        });
      }
      if (onProgress) onProgress(Math.min(comments.length, i + BATCH), comments.length);
    }
    return result;
  }

  /** Gera interpretação narrativa (motivações + relatório qualitativo). */
  async function narrativeReport(cfg, raw, agg) {
    const prompt =
`Analise por que esta publicação do LinkedIn gerou engajamento. Diferencie SEMPRE dado observado de hipótese, usando expressões como "Os dados mostram...", "Os comentários sugerem...", "Uma hipótese plausível é...", "Não é possível determinar apenas pelas métricas disponíveis...".

POST (${raw.post.type}):
"""${(raw.post.content.fullText || '').slice(0, 3000)}"""

MÉTRICAS: reações=${raw.metrics.reactions.raw || 'indisponível'}, comentários=${raw.metrics.comments.raw || 'indisponível'}, compartilhamentos=${raw.metrics.reposts.raw || 'indisponível'}. Cobertura de comentários: ${raw.coverage.commentsLoaded}/${raw.coverage.commentsDeclared ?? '?'}.

DISTRIBUIÇÕES OBSERVADAS: sentimentos=${JSON.stringify(agg.sentimentDist)}; emoções=${JSON.stringify(agg.emotionDist)}; clusters=${JSON.stringify(agg.clusters.map(c => ({ n: c.name, pct: c.pct })))}.

AMOSTRA DE COMENTÁRIOS: ${JSON.stringify(agg.clusters.slice(0, 6).flatMap(c => c.examples.slice(0, 2)))}

Responda APENAS com JSON válido:
{"narrative":"análise em 3-5 parágrafos","whyLikes":"...","whyComments":"...","whyShares":"...","needServed":"...","replicable":["..."],"contextDependent":["..."],"risks":["..."]}`;

    const text = await call(cfg.provider, cfg.model, cfg.apiKey, prompt);
    return extractJson(text);
  }

  globalThis.__LPA_AI = {
    PROVIDERS,
    call,
    classifyComments,
    narrativeReport,
    /** Descrição de consentimento: o que será enviado, para onde e por quê. */
    consentInfo(cfg, raw) {
      const p = PROVIDERS[cfg.provider];
      return {
        service: p.label + ' (' + p.endpointHost + ')',
        model: cfg.model || p.defaultModel,
        dataSent: [
          'Texto da publicação (truncado em 3.000 caracteres)',
          `Texto de ${raw.comments.length} comentários (cada um truncado em 400 caracteres)`,
          'Métricas agregadas visíveis (números de reações/comentários/compartilhamentos)'
        ],
        dataNotSent: ['Cookies e credenciais', 'URLs de perfis', 'Sua chave é enviada apenas ao provedor escolhido, como autenticação'],
        purpose: 'Análise de sentimento, clusterização semântica, motivações e relatório interpretativo.'
      };
    }
  };
})();
