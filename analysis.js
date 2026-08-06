/**
 * analysis.js
 * Motor de análise do MODO LOCAL (baseado em regras e léxicos embutidos).
 *
 * Honestidade epistêmica:
 *  - Cada bloco interpretativo carrega kind: "observation" | "hypothesis".
 *  - Sentimento local usa léxico pt/en; a confiança reflete a fraqueza do método.
 *  - Quando o contexto não permite classificação segura, o rótulo é "indeterminado".
 *  - No modo IA os campos de sentimento/cluster/narrativa são substituídos com source: "ai".
 */
(function () {
  if (globalThis.__LPA_ANALYSIS) return;
  const U = globalThis.__LPA_UTILS;
  const A = {};

  // ------------------------------------------------------------------- léxicos

  const POS = ('otimo excelente incrivel sensacional maravilhoso perfeito top parabens obrigado obrigada gratidao valeu amei adorei util utilissimo esclarecedor genial brilhante inspirador necessario relevante importante concordo apoio verdade certeiro preciso pratico didatico claro objetivo rico valioso fantastico espetacular sucesso admiro respeito referencia aula show massa demais fera craque mandou arrasou ' +
    'great excellent amazing awesome wonderful perfect love loved helpful useful insightful brilliant inspiring valuable agree true spot accurate practical clear congrats congratulations thanks thank grateful appreciate respect masterclass gold').split(' ');

  const NEG = ('ruim pessimo horrivel errado discordo mentira falso enganoso raso superficial obvio clickbait chato cansativo repetitivo duvido cuidado perigoso irresponsavel absurdo lamentavel decepcionante fraco generico vazio bobagem furada golpe ' +
    'bad terrible wrong disagree false misleading shallow obvious clickbait boring lazy dangerous irresponsible absurd disappointing weak generic scam nonsense overrated').split(' ');

  const NEGATORS = ('nao nunca jamais nem not never no dont doesnt isnt wasnt cant').split(' ');

  const POS_EMOJI = ['👏', '🙌', '❤', '❤️', '😍', '🔥', '💪', '🚀', '✨', '🙏', '👍', '💯', '🎉', '😊', '🤩'];
  const NEG_EMOJI = ['👎', '😡', '🤬', '😠', '🙄', '😤', '💩', '😒'];

  const EMOTION_PATTERNS = [
    ['gratidão', /obrigad|gratidao|valeu|agradec|thank|grateful|appreciate/i],
    ['celebração', /parabens|congrat|felicita|🎉|👏/i],
    ['entusiasmo', /incrivel|sensacional|amazing|awesome|🔥|🚀|amei|love[d]? (it|this)/i],
    ['admiração', /admiro|referencia|masterclass|aula|brilhante|brilliant|respect/i],
    ['identificação', /me identifiquei|exatamente o que|passei por isso|same here|relat(e|able)|comigo (foi|e) (igual|assim)|tambem (passei|vivo|vivi)/i],
    ['curiosidade', /como (voce|vc|fez|funciona)|onde (posso|encontro)|qual (ferramenta|curso)|curios|how (do|did) you|where can/i],
    ['dúvida', /\?|duvida|nao entendi|pode explicar|question|not sure|confus/i],
    ['concordância', /concordo|exatamente|isso mesmo|verdade|agree|exactly|spot on|100%/i],
    ['discordância', /discordo|nao concordo|disagree|na verdade nao|penso diferente|not (really|true)/i],
    ['crítica', /faltou|problema|errado|equivocad|cuidado com|irresponsavel|misleading|wrong|missing the/i],
    ['ceticismo', /sera(?![a-z])|duvido|na pratica|hype|papel aceita tudo|too good|skeptic|really\?/i],
    ['humor', /kkk+|haha+|rsrs|😂|🤣|lol|lmao/i],
    ['frustração', /cansad|frustra|infelizmente|chateado|fed up|tired of|frustrat/i],
    ['surpresa', /nossa|uau|caramba|nao sabia|wow|didn.?t know|mind ?blow/i],
    ['apoio', /forca|conte comigo|estamos juntos|apoio|support you|rooting/i]
  ];

  const GENERIC_RE = /^(parabens|excelente|otimo|muito bom|top|show|perfeito|verdade|isso|concordo|obrigad[oa]( por compartilhar)?|sensacional|incrivel|util|great( post)?|nice|awesome|well said|so true|thanks( for sharing)?|congrats|amazing|love (this|it)|👏+|🔥+|💯+)[.!\s👏🔥💯🙌❤️]*$/i;

  // -------------------------------------------------------- limpeza/normalização

  A.prepareComments = function (rawComments) {
    const seen = new Set();
    const out = [];
    for (const c of rawComments || []) {
      const key = U.hash((c.author && c.author.name || '') + '|' + (c.text || '').slice(0, 160));
      if (seen.has(key)) continue; // duplicidade (re-coleta ou DOM repetido)
      seen.add(key);
      const textNormalized = U.normalizeForNlp(c.text);
      out.push(Object.assign({}, c, {
        textNormalized,
        flags: Object.assign({}, c.flags, {
          emojiOnly: U.isEmojiOnly(c.text),
          mentionOnly: (function () {
            const mentions = c.mentions || [];
            if (!c.text || !mentions.length) return false;
            let t = U.cleanText(c.text);
            for (const m of mentions) t = t.split(m.replace(/^@/, '')).join(' ');
            t = t.replace(/@[\p{L}\p{N}._-]+/gu, '').replace(/[\s.,!?]+/g, '');
            return t.length === 0;
          })(),
          genericOnly: GENERIC_RE.test(U.normalizeForNlp(c.text))
        })
      }));
    }
    return out;
  };

  /** Mescla duas coletas preservando a união dos comentários (para "Atualizar coleta"). */
  A.mergeComments = function (oldList, newList) {
    const map = new Map();
    for (const c of (oldList || [])) map.set(c.id, c);
    for (const c of (newList || [])) {
      const prev = map.get(c.id);
      if (prev && prev.sentiment && prev.sentiment.source === 'ai') {
        // Re-coleta não descarta classificação de IA já obtida
        map.set(c.id, Object.assign({}, c, {
          sentiment: prev.sentiment,
          clusters: prev.clusters,
          clustersSource: prev.clustersSource
        }));
      } else {
        map.set(c.id, c);
      }
    }
    return Array.from(map.values());
  };

  // ---------------------------------------------------------------- sentimento

  A.sentimentOf = function (comment) {
    const text = comment.textNormalized || U.normalizeForNlp(comment.text);
    const rawText = comment.text || '';
    const tokens = text.split(/[^a-z0-9#@]+/).filter(Boolean);

    if (comment.flags && comment.flags.emojiOnly) {
      const pos = comment.emojis.filter(e => POS_EMOJI.includes(e)).length;
      const neg = comment.emojis.filter(e => NEG_EMOJI.includes(e)).length;
      const label = pos > neg ? 'positivo' : neg > pos ? 'negativo' : 'indeterminado';
      return { label, emotion: pos > neg ? 'apoio' : null, intensity: 0.4, confidence: 0.5, rationale: 'Comentário composto apenas por emojis; polaridade inferida pelos emojis.', source: 'rules' };
    }
    if (!text) {
      return { label: 'indeterminado', emotion: null, intensity: 0, confidence: 0.2, rationale: 'Sem texto analisável.', source: 'rules' };
    }

    let pos = 0, neg = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const negated = i > 0 && NEGATORS.includes(tokens[i - 1]);
      if (POS.includes(t)) negated ? neg++ : pos++;
      if (NEG.includes(t)) negated ? pos++ : neg++;
    }
    pos += comment.emojis.filter(e => POS_EMOJI.includes(e)).length * 0.5;
    neg += comment.emojis.filter(e => NEG_EMOJI.includes(e)).length * 0.5;

    let emotion = null;
    for (const [name, re] of EMOTION_PATTERNS) {
      if (re.test(rawText) || re.test(text)) { emotion = name; break; }
    }

    const total = pos + neg;
    let label, intensity, confidence, rationale;
    const ironyRisk = /kkk|haha|😂|🤣|"[^"]+"|so ?bre|claro que sim|aham|sei/i.test(rawText) && neg + pos > 0;

    if (total === 0) {
      const isQuestion = /\?/.test(rawText);
      label = 'neutro';
      emotion = emotion || (isQuestion ? 'curiosidade' : null);
      intensity = 0.2;
      confidence = 0.45;
      rationale = isQuestion ? 'Pergunta sem carga avaliativa detectável pelo léxico.' : 'Nenhum termo avaliativo do léxico foi encontrado.';
    } else if (pos > 0 && neg > 0 && Math.min(pos, neg) / total >= 0.3) {
      label = 'misto';
      intensity = U.clamp(total / Math.max(6, tokens.length / 3), 0.2, 0.9);
      confidence = 0.5;
      rationale = `Termos positivos (${pos.toFixed(1)}) e negativos (${neg.toFixed(1)}) coexistem.`;
    } else if (pos >= neg) {
      label = 'positivo';
      intensity = U.clamp(pos / Math.max(4, tokens.length / 4), 0.25, 1);
      confidence = U.clamp(0.5 + pos * 0.08, 0.5, 0.85);
      rationale = `Predomínio de termos/emojis positivos (score ${pos.toFixed(1)} vs ${neg.toFixed(1)}).`;
    } else {
      label = 'negativo';
      intensity = U.clamp(neg / Math.max(4, tokens.length / 4), 0.25, 1);
      confidence = U.clamp(0.5 + neg * 0.08, 0.5, 0.85);
      rationale = `Predomínio de termos/emojis negativos (score ${neg.toFixed(1)} vs ${pos.toFixed(1)}).`;
    }

    if (ironyRisk) {
      confidence = Math.min(confidence, 0.4);
      if (confidence < 0.45) label = 'indeterminado';
      rationale += ' Possível ironia/humor detectado; classificação rebaixada.';
    }

    return { label, emotion, intensity: Math.round(intensity * 100) / 100, confidence: Math.round(confidence * 100) / 100, rationale, source: 'rules' };
  };

  // ------------------------------------------------------------- clusterização

  const CLUSTER_RULES = [
    ['agradecimento', /obrigad|gratidao|valeu|agradec|thank/i],
    ['elogio', /parabens|excelente|otimo|incrivel|sensacional|top|show|brilhante|great|awesome|amazing|congrats|well said/i],
    ['marcação de outras pessoas', c => c.flags.mentionOnly || (c.mentions.length > 0 && U.countWords(c.text) <= c.mentions.length + 3)],
    ['experiência pessoal', /na minha (experiencia|empresa|equipe)|eu (passei|vivi|fiz|usei|apliquei)|aqui na|comigo foi|in my (experience|company|team)|i (did|used|tried|went through)/i],
    ['concordância', /concordo|exatamente|isso mesmo|verdade|agree|exactly|spot on/i],
    ['discordância', /discordo|nao concordo|penso diferente|disagree|not (really|true)|na verdade/i],
    ['crítica', /faltou|problema|errad|equivocad|cuidado|irresponsavel|misleading|wrong|shallow|raso/i],
    ['dúvida', c => /\?/.test(c.text || '') && !/link|material|planilha|pdf|template/i.test(c.textNormalized)],
    ['pedido de material', /pode (mandar|enviar|compartilhar)|me (manda|envia)|onde (baixo|acesso|encontro)|tem o link|link\?|quero o (material|pdf|template|e-?book)|can you (send|share)|where can i (get|download)/i],
    ['complemento técnico', /complementando|vale (lembrar|acrescentar)|alem disso|outro ponto|adding to|also worth|one more thing|na pratica tambem/i],
    ['recomendação', /recomendo|sugiro|vale a pena|indico|recommend|suggest|worth (checking|reading)/i],
    ['networking', /vamos (conversar|trocar)|te chamei|conectar|call|inbox|dm|let.?s connect|coffee/i],
    ['autopromoção', /no meu (perfil|post|artigo|canal)|escrevi sobre|falo sobre isso em|check (out )?my|i wrote about|meu (curso|livro|podcast)/i],
    ['humor', /kkk+|haha+|rsrs|😂|🤣|lol|lmao/i],
    ['relato de resultado', /consegui|aumentei|reduzi|cresci|resultado|funcionou|got results|increased|reduced|worked for/i],
    ['intenção de uso', /vou (testar|aplicar|usar|tentar|implementar|salvar)|salvando|guardando|will (try|use|apply|save)|saving this/i],
    ['defesa do autor', /quem critica|nao entenderam|o autor (esta|tem) raz|haters|ele so quis dizer|missing the point/i],
    ['conversa paralela', c => c.level > 0 && c.mentions.length > 0 && !/obrigad|thank|parabens/i.test(c.textNormalized)]
  ];

  A.clustersOf = function (comment) {
    const clusters = [];
    for (const [name, rule] of CLUSTER_RULES) {
      const hit = typeof rule === 'function' ? rule(comment) : (rule.test(comment.text || '') || rule.test(comment.textNormalized || ''));
      if (hit) clusters.push(name);
    }
    if (comment.flags.genericOnly && !clusters.includes('comentário genérico')) clusters.push('comentário genérico');
    if (clusters.length === 0) clusters.push(U.countWords(comment.text) >= 15 ? 'complemento técnico' : 'comentário genérico');
    return clusters;
  };

  // --------------------------------------------------------- avaliação do post

  function score(value, rationale) {
    return { score: Math.round(U.clamp(value, 0, 10) * 10) / 10, rationale, kind: 'heuristic' };
  }

  A.scorePost = function (raw, comments) {
    const c = raw.post.content;
    const t = c.fullText || '';
    const n = U.normalizeForNlp(t);
    const words = c.stats.words;
    const hook = c.hookText || '';
    const avgWordsPerParagraph = words / Math.max(1, c.stats.paragraphs);
    const hasNumbers = /\d/.test(t);
    const hasQuestion = /\?/.test(t);
    const hasList = /\n\s*(?:\d+[.)]|[-–•→✅✔️])/m.test(t);
    const firstPerson = /\b(eu|minha|meu|comigo|i |my |me )\b/i.test(t);
    const contrarian = /ninguem (fala|conta)|impopular|polemic|unpopular|contrari|para de|pare de|esquece o que/i.test(n);
    const howTo = /como (eu|voce|fazer)|passo a passo|framework|metodo|checklist|guia|how to|step by step/i.test(n);

    const scores = {
      'força do gancho': score(
        3 + (hook.length > 0 ? 1 : 0) + (/\d/.test(hook) ? 1.5 : 0) + (/\?/.test(hook) ? 1 : 0) + (contrarian ? 2 : 0) + (hook.length < 140 ? 1 : 0) + (/^(eu|i )/i.test(hook) ? 0.5 : 0),
        'Heurística: presença de número, pergunta, contraste/controvérsia e concisão nas primeiras linhas.'),
      'clareza': score(
        8 - (avgWordsPerParagraph > 60 ? 2 : 0) - (words > 0 && c.stats.paragraphs === 1 && words > 80 ? 2 : 0) + (hasList ? 1 : 0),
        'Heurística: parágrafos curtos e listas elevam; blocos densos reduzem.'),
      'facilidade de leitura': score(
        7 + (hasList ? 1.5 : 0) + (avgWordsPerParagraph <= 30 ? 1 : 0) - (words > 400 ? 1.5 : 0),
        'Heurística: densidade por parágrafo, uso de listas e extensão total.'),
      'utilidade prática': score(
        3 + (howTo ? 3 : 0) + (hasList ? 1.5 : 0) + (hasNumbers ? 1 : 0) + (c.cta.type === 'download' ? 1.5 : 0),
        'Heurística: instruções acionáveis, listas, dados e oferta de material.'),
      'originalidade': score(
        4 + (contrarian ? 2.5 : 0) + (firstPerson ? 1 : 0) + (raw.post.type !== 'text' ? 0.5 : 0),
        'Heurística limitada: sinais de contraponto e relato próprio. Originalidade real exige comparação com outros conteúdos (indisponível).'),
      'profundidade': score(
        2 + Math.min(4, words / 120) + (hasNumbers ? 1 : 0) + (howTo ? 1.5 : 0),
        'Heurística: extensão útil, dados e estrutura de método.'),
      'credibilidade': score(
        4 + (hasNumbers ? 1.5 : 0) + (c.links.length > 0 ? 1 : 0) + (/fonte|estudo|pesquisa|dados de|source|study|research/i.test(n) ? 2 : 0),
        'Heurística: números, links e citação de fontes.'),
      'autoridade percebida': score(
        3 + (raw.post.author.followers.available ? Math.min(3, Math.log10(Math.max(10, raw.post.author.followers.normalized)) - 1) : 0) + (firstPerson && /anos|years|carreira|career|clientes|clients/i.test(n) ? 2 : 0),
        'Heurística: seguidores visíveis e sinais de experiência declarada no texto.'),
      'identificação emocional': score(
        3 + (firstPerson ? 2 : 0) + (/erro|falha|dificil|medo|fracasso|demitid|burnout|cansad|mistake|failure|fear|fired/i.test(n) ? 2.5 : 0) + (c.emojis.length > 0 ? 0.5 : 0),
        'Heurística: narrativa pessoal e vocabulário de vulnerabilidade.'),
      'potencial de debate': score(
        2 + (contrarian ? 3.5 : 0) + (hasQuestion ? 1.5 : 0) + (/certo ou errado|concorda|o que voce acha|what do you think|agree\?/i.test(n) ? 2 : 0),
        'Heurística: posicionamento polêmico e convites explícitos à opinião.'),
      'potencial de compartilhamento': score(
        3 + (howTo ? 2 : 0) + (hasList ? 1.5 : 0) + (c.cta.type === 'compartilhar' ? 1 : 0) + (words >= 100 && words <= 350 ? 1 : 0),
        'Heurística: conteúdo de referência (listas, métodos) em extensão compartilhável.'),
      'qualidade do CTA': score(
        c.cta.present ? 6 + (c.cta.type === 'comentar' || c.cta.type === 'pergunta' ? 1.5 : 0) : 2,
        c.cta.present ? `CTA do tipo "${c.cta.type}" identificado.` : 'Nenhum CTA explícito identificado.'),
      'força da promessa': score(
        3 + (/em \d+ (dias|passos|minutos)|in \d+ (days|steps|minutes)/i.test(n) ? 2.5 : 0) + (howTo ? 2 : 0) + (/gratis|gratuito|free/i.test(n) ? 1 : 0),
        'Heurística: promessa quantificada, método e oferta gratuita.'),
      'relevância para o público': score(
        5 + (c.hashtags.length > 0 && c.hashtags.length <= 5 ? 1 : 0) + (howTo ? 1 : 0),
        'Heurística fraca: sem dados de audiência, avalia apenas sinais de segmentação. Trate como aproximação.'),
      'densidade informacional': score(
        2 + Math.min(5, (t.match(/\d+[%$R]?/g) || []).length * 0.8) + (hasList ? 1.5 : 0) + (c.links.length ? 0.5 : 0),
        'Heurística: quantidade de dados concretos por extensão de texto.')
    };

    return scores;
  };

  // ----------------------------------------------------------------- gancho

  A.analyzeHook = function (raw) {
    const hook = raw.post.content.hookText || '';
    const n = U.normalizeForNlp(hook);
    const cats = [];
    if (/\d/.test(hook)) cats.push('número ou dado');
    if (/\?/.test(hook)) cats.push('pergunta');
    if (/ninguem|segredo|o que nao te|nobody|secret|what no one/i.test(n)) cats.push('curiosidade');
    if (/como |aprenda|voce pode|how to|you can/i.test(n)) cats.push('benefício direto');
    if (/impopular|polemic|discordo|pare de|esquece|unpopular|stop doing|controversial/i.test(n)) cats.push('controvérsia');
    if (/eu |minha|quando eu|i |my |when i/i.test(n) && /err|falh|demit|fracass|perdi|mistake|fail|fired|lost/i.test(n)) cats.push('história pessoal');
    else if (/^(eu|em \d{4}|ha \d+ anos|i |in \d{4})/i.test(n)) cats.push('história pessoal');
    if (/cansad|dificil|dor|problema|frustra|tired|struggling|pain|problem/i.test(n)) cats.push('dor');
    if (/antes que|ultima chance|acabou|vai perder|before it|last chance|missing out/i.test(n)) cats.push('medo de perda');
    if (/oportunidade|vaga|mercado|crescendo|opportunity|hiring|growing/i.test(n)) cats.push('oportunidade');
    if (/anos de|depois de \d+|especialista|years of|after \d+|expert/i.test(n)) cats.push('autoridade');
    if (/acaba de|anunciou|lancou|nova|breaking|just (launched|announced)|news/i.test(n)) cats.push('notícia');
    if (/mas |porem|nao e o que|but |however|not what/i.test(n)) cats.push('quebra de expectativa');
    if (/voce ja|se voce|todo mundo|have you ever|if you|everyone/i.test(n)) cats.push('identificação');
    if (cats.length === 0) cats.push('indeterminado');

    const fullN = U.normalizeForNlp(raw.post.content.fullText);
    const promiseDelivered = /passo|lista|exemplo|como fazer|framework|resposta|conclusao|step|list|example|answer/i.test(fullN);

    return {
      text: hook,
      categories: cats,
      truncatedInDom: raw.post.content.truncatedInDom,
      whyItStopsScroll: cats.includes('indeterminado')
        ? 'Não foi possível identificar um mecanismo claro de interrupção de rolagem nas primeiras linhas.'
        : `O gancho combina os mecanismos [${cats.join(', ')}], que tendem a interromper a rolagem por criarem tensão informacional antes do "ver mais".`,
      expectationCreated: cats.includes('número ou dado') ? 'Expectativa de informação concreta e verificável.'
        : cats.includes('controvérsia') ? 'Expectativa de um posicionamento que contraria o senso comum.'
        : cats.includes('história pessoal') ? 'Expectativa de um desfecho narrativo com lição aplicável.'
        : cats.includes('benefício direto') ? 'Expectativa de instrução prática imediata.'
        : 'Expectativa difusa; depende do interesse prévio do leitor no tema.',
      expectationDelivered: { value: promiseDelivered, kind: 'hypothesis', note: promiseDelivered ? 'O corpo apresenta estrutura de entrega (passos, exemplos ou conclusão).' : 'O corpo não apresenta marcadores claros de entrega; possível lacuna entre promessa e conteúdo.' },
      curiosityGap: { value: raw.post.content.truncatedInDom || /\.\.\.|…/.test(hook), kind: 'hypothesis', note: 'Avaliado pela existência de truncamento/reticências no ponto de corte.' },
      dependsOnAuthorReputation: { value: !( /\d/.test(hook) || /\?/.test(hook) ) && (raw.post.author.followers.available && raw.post.author.followers.normalized > 50000), kind: 'hypothesis', note: 'Ganchos sem mecanismo intrínseco em perfis grandes tendem a depender da reputação do autor.' }
    };
  };

  // -------------------------------------------------- agregações e indicadores

  A.aggregate = function (raw, comments) {
    const total = comments.length;

    const sentimentDist = {};
    const emotionDist = {};
    for (const c of comments) {
      sentimentDist[c.sentiment.label] = (sentimentDist[c.sentiment.label] || 0) + 1;
      if (c.sentiment.emotion) emotionDist[c.sentiment.emotion] = (emotionDist[c.sentiment.emotion] || 0) + 1;
    }

    const clusterAgg = {};
    for (const c of comments) {
      for (const cl of c.clusters) {
        if (!clusterAgg[cl]) clusterAgg[cl] = { count: 0, examples: [], intensitySum: 0 };
        clusterAgg[cl].count++;
        clusterAgg[cl].intensitySum += c.sentiment.intensity;
        if (clusterAgg[cl].examples.length < 3 && U.countWords(c.text) >= 3) {
          clusterAgg[cl].examples.push({ author: c.author.name, text: (c.text || '').slice(0, 220) });
        }
      }
    }
    const clusters = Object.entries(clusterAgg).map(([name, v]) => ({
      name, count: v.count, pct: U.pct(v.count, total),
      avgIntensity: total ? Math.round((v.intensitySum / v.count) * 100) / 100 : 0,
      examples: v.examples
    })).sort((a, b) => b.count - a.count);

    const withReplies = comments.filter(c => (c.repliesCount.normalized || 0) > 0 || comments.some(o => o.parentId === c.id));
    const topDiscussion = [...comments]
      .filter(c => c.level === 0)
      .sort((a, b) => (b.repliesCount.normalized || 0) - (a.repliesCount.normalized || 0))
      .slice(0, 5)
      .map(c => ({ author: c.author.name, text: (c.text || '').slice(0, 220), replies: c.repliesCount }));

    const generic = comments.filter(c => c.flags.genericOnly || c.flags.emojiOnly || c.flags.mentionOnly);
    const contributing = comments.filter(c => c.clusters.some(cl => ['experiência pessoal', 'complemento técnico', 'crítica', 'discordância', 'relato de resultado', 'recomendação'].includes(cl)) && !c.flags.genericOnly);
    const intent = comments.filter(c => c.clusters.includes('intenção de uso') || c.clusters.includes('pedido de material'));

    const quality = {
      genericRate: { value: U.pct(generic.length, total), formula: 'comentários (genéricos + só emoji + só marcação) / total de comentários coletados × 100' },
      conversationRate: { value: U.pct(withReplies.length, total), formula: 'comentários com ≥1 resposta observada / total × 100' },
      contributionRate: { value: U.pct(contributing.length, total), formula: 'comentários com experiência, complemento, contraponto ou exemplo / total × 100' },
      intentRate: { value: U.pct(intent.length, total), formula: 'comentários com intenção de uso ou pedido de material / total × 100' },
      avgDepth: null
    };

    const avgWords = total ? comments.reduce((s, c) => s + U.countWords(c.text), 0) / total : 0;
    quality.avgDepth = {
      value: avgWords >= 25 && quality.contributionRate.value >= 30 ? 'alta' : (avgWords >= 10 || quality.contributionRate.value >= 15 ? 'média' : 'baixa'),
      formula: 'alta: média ≥25 palavras E contribuição ≥30%; média: ≥10 palavras OU contribuição ≥15%; baixa: caso contrário',
      avgWordsPerComment: Math.round(avgWords * 10) / 10
    };

    let engagementClass = 'superficial';
    if (quality.contributionRate.value >= 35) engagementClass = 'informacional';
    else if ((sentimentDist['negativo'] || 0) / Math.max(1, total) >= 0.25) engagementClass = 'crítico';
    else if (quality.conversationRate.value >= 30) engagementClass = 'conversacional';
    else if ((emotionDist['identificação'] || 0) + (emotionDist['gratidão'] || 0) >= total * 0.3) engagementClass = 'emocional';
    else if (clusters.find(c => c.name === 'networking' || c.name === 'autopromoção') && quality.genericRate.value < 40) engagementClass = 'relacional';
    if (clusters.find(c => c.name === 'pedido de material') && clusterAgg['pedido de material'].count >= total * 0.25) engagementClass = 'comercial';

    return { sentimentDist, emotionDist, clusters, topDiscussion, quality, engagementClass, totalAnalyzed: total };
  };

  // ------------------------------------------------------------------- índices

  A.indices = function (raw, agg, scores) {
    const total = Math.max(1, agg.totalAnalyzed);
    const s = k => scores[k] ? scores[k].score : 5;
    const method = 'Índice analítico de 0 a 100 criado por esta extensão. NÃO é uma métrica oficial do LinkedIn. Limitações: amostra restrita aos comentários carregados; heurísticas baseadas em regras.';

    function idx(value, methodology) {
      return { value: Math.round(U.clamp(value, 0, 100)), methodology: methodology + ' ' + method, kind: 'heuristic' };
    }

    const identifRatio = ((agg.emotionDist['identificação'] || 0) + (agg.clusters.find(c => c.name === 'experiência pessoal') || { count: 0 }).count) / total;
    const gratRatio = ((agg.emotionDist['gratidão'] || 0) + (agg.emotionDist['entusiasmo'] || 0)) / total;

    return {
      'potencial de identificação': idx(s('identificação emocional') * 6 + identifRatio * 40, 'Fórmula: nota de identificação emocional × 6 + proporção de comentários de identificação/experiência × 40.'),
      'utilidade percebida': idx(s('utilidade prática') * 5 + (agg.quality.intentRate.value * 0.5), 'Fórmula: nota de utilidade prática × 5 + taxa de intenção × 0,5.'),
      'força emocional': idx(gratRatio * 60 + s('identificação emocional') * 4, 'Fórmula: proporção de emoções de alta ativação × 60 + nota de identificação × 4.'),
      'força conversacional': idx(agg.quality.conversationRate.value * 0.7 + s('potencial de debate') * 3, 'Fórmula: taxa de conversação × 0,7 + nota de potencial de debate × 3.'),
      'potencial de compartilhamento': idx(s('potencial de compartilhamento') * 6 + (raw.metrics.reposts.available && raw.metrics.reactions.available && raw.metrics.reactions.normalized > 0 ? U.clamp(raw.metrics.reposts.normalized / raw.metrics.reactions.normalized, 0, 0.4) * 100 : 0), 'Fórmula: nota heurística × 6 + razão compartilhamentos/reações × 100 (teto 40).'),
      'autoridade percebida': idx(s('autoridade percebida') * 7 + ((agg.emotionDist['admiração'] || 0) / total) * 30, 'Fórmula: nota de autoridade × 7 + proporção de comentários de admiração × 30.'),
      'profundidade do debate': idx(agg.quality.contributionRate.value * 0.6 + (agg.quality.avgDepth.avgWordsPerComment || 0), 'Fórmula: taxa de contribuição × 0,6 + média de palavras por comentário (teto 100).'),
      'qualidade geral do engajamento': idx((100 - agg.quality.genericRate.value) * 0.4 + agg.quality.contributionRate.value * 0.4 + agg.quality.conversationRate.value * 0.2, 'Fórmula: (100 − taxa de genéricos) × 0,4 + contribuição × 0,4 + conversação × 0,2.')
    };
  };

  // ---------------------------------------------------------------- motivações

  A.motivations = function (raw, agg) {
    const total = Math.max(1, agg.totalAnalyzed);
    const cl = name => (agg.clusters.find(c => c.name === name) || { count: 0, pct: 0 });
    const em = name => agg.emotionDist[name] || 0;
    const out = { reactions: [], comments: [], shares: [], disclaimer: 'Motivações são HIPÓTESES interpretativas construídas a partir dos padrões observados nos comentários. Reações e compartilhamentos não expõem motivação individual; não é possível determinar causas apenas pelas métricas disponíveis.' };

    function h(text, evidence, strength) {
      return { hypothesis: text, evidence, strength, kind: 'hypothesis' };
    }

    // Reações
    if (em('concordância') / total > 0.15) out.reactions.push(h('Concordância com a tese central.', `Os comentários sugerem: ${em('concordância')} comentários de concordância explícita (${U.pct(em('concordância'), total)}%).`, 'média'));
    if (em('gratidão') / total > 0.1 || cl('agradecimento').count > 0) out.reactions.push(h('Utilidade e gratidão pelo conteúdo.', `Os dados mostram ${cl('agradecimento').count} agradecimentos entre os comentários coletados.`, 'média'));
    if (em('identificação') / total > 0.1) out.reactions.push(h('Identificação pessoal com a situação descrita.', `${em('identificação')} comentários expressam identificação.`, 'média'));
    if (em('celebração') > 0) out.reactions.push(h('Apoio social e celebração do autor.', `${em('celebração')} comentários celebratórios observados.`, 'fraca'));
    if (out.reactions.length === 0) out.reactions.push(h('Consumo rápido e sinalização de afinidade de baixo custo.', 'Não é possível determinar apenas pelas métricas disponíveis; ausência de padrões fortes nos comentários sugere reação de baixo esforço.', 'fraca'));

    // Comentários
    const pairs = [
      ['agradecimento', 'Desejo de agradecer publicamente.'],
      ['dúvida', 'Necessidade de tirar uma dúvida com o autor.'],
      ['complemento técnico', 'Vontade de complementar com conhecimento próprio.'],
      ['experiência pessoal', 'Identificação pessoal e desejo de compartilhar a própria vivência.'],
      ['discordância', 'Discordância com a tese apresentada.'],
      ['autopromoção', 'Busca de visibilidade perante a audiência do post.'],
      ['marcação de outras pessoas', 'Marcação de colegas para os quais o conteúdo é relevante.'],
      ['pedido de material', 'Pedido de acesso a material, link ou recurso prometido.'],
      ['networking', 'Tentativa de iniciar relacionamento com o autor.']
    ];
    for (const [name, text] of pairs) {
      const c = cl(name);
      if (c.count > 0) out.comments.push(h(text, `Os dados mostram ${c.count} comentários (${c.pct}%) na categoria "${name}".`, c.pct >= 20 ? 'forte' : c.pct >= 8 ? 'média' : 'fraca'));
    }
    if (out.comments.length === 0) out.comments.push(h('Sem comentários suficientes para inferir motivações.', 'Amostra vazia ou muito pequena.', 'fraca'));

    // Compartilhamentos
    const utilScore = cl('intenção de uso').pct + cl('pedido de material').pct;
    if (utilScore > 10) out.shares.push(h('Utilidade para a rede e valor de consulta futura.', `Uma hipótese plausível é curadoria de conteúdo útil: ${utilScore}% dos comentários demonstram intenção de uso ou pedido de material.`, 'média'));
    if (em('admiração') / total > 0.1) out.shares.push(h('Sinalização de conhecimento e associação com o tema/autor.', `${em('admiração')} comentários de admiração sugerem valor de referência.`, 'fraca'));
    if (em('discordância') + em('crítica') > total * 0.2) out.shares.push(h('Desejo de iniciar uma discussão (compartilhamento com comentário crítico).', 'A proporção de crítica/discordância nos comentários sugere debate ativo.', 'fraca'));
    out.shares.push(h('Construção de autoridade de quem compartilha perante a própria rede.', 'Não é possível determinar apenas pelas métricas disponíveis; hipótese padrão para conteúdo profissional no LinkedIn.', 'fraca'));

    return out;
  };

  // ------------------------------------------------------------------ relatório

  A.buildReport = function (raw, agg, scores, hook, indices, motivations) {
    const sentTop = Object.entries(agg.sentimentDist).sort((a, b) => b[1] - a[1])[0];
    const topCluster = agg.clusters[0];
    const cov = raw.coverage;
    const coverageNote = cov.complete
      ? 'Coleta de comentários aparentemente completa.'
      : `Coleta PARCIAL: ${cov.commentsLoaded} de ${cov.commentsDeclared != null ? cov.commentsDeclared + ' declarados pelo LinkedIn' : 'total desconhecido'}${cov.ratio != null ? ` (cobertura ${(cov.ratio * 100).toFixed(1)}%)` : ''}. Conclusões refletem apenas a amostra carregada.`;

    const bestScore = Object.entries(scores).sort((a, b) => b[1].score - a[1].score)[0];
    const worstScore = Object.entries(scores).sort((a, b) => a[1].score - b[1].score)[0];

    const diagnosis = {
      'Por que as pessoas provavelmente curtiram?': motivations.reactions.map(m => m.hypothesis).join(' ') + ' (hipóteses; ver evidências)',
      'Por que decidiram comentar?': motivations.comments.slice(0, 3).map(m => m.hypothesis).join(' '),
      'Por que decidiram compartilhar?': raw.metrics.reposts.available ? motivations.shares.map(m => m.hypothesis).join(' ') : 'Dado de compartilhamentos indisponível na página; não é possível avaliar.',
      'O engajamento foi profundo ou superficial?': `Classificação: ${agg.engagementClass}. Taxa de genéricos ${agg.quality.genericRate.value}%, contribuição ${agg.quality.contributionRate.value}%, profundidade média ${agg.quality.avgDepth.value}.`,
      'O conteúdo funcionou pelo tema, pela estrutura, pela oferta ou pela autoridade?': `Uma hipótese plausível: o fator dominante é "${bestScore[0]}" (nota ${bestScore[1].score}/10). ${hook.dependsOnAuthorReputation.value ? 'Há sinais de dependência da reputação do autor.' : 'Não há sinais fortes de dependência exclusiva da reputação do autor.'}`,
      'Qual necessidade foi atendida?': agg.engagementClass === 'informacional' ? 'Funcional: aprendizado aplicável.' : agg.engagementClass === 'emocional' ? 'Emocional: identificação e pertencimento.' : agg.engagementClass === 'relacional' ? 'Social: visibilidade e conexão.' : 'Mista; os comentários sugerem combinação de utilidade e sinalização social.',
      'Quais elementos poderiam ser replicados?': `Estrutura do gancho (${hook.categories.join(', ')}), formato "${raw.post.type}" e o elemento mais forte: ${bestScore[0]}.`,
      'Quais elementos dependem do contexto ou da reputação?': hook.dependsOnAuthorReputation.value ? 'O gancho e parte do engajamento aparentam depender da audiência já construída pelo autor.' : `Principalmente a autoridade percebida (${scores['autoridade percebida'].score}/10) e o timing do tema, que não se transferem automaticamente.`
    };

    return {
      summary: {
        theme: null, // preenchido por themes() abaixo
        mainDriver: { value: bestScore[0] + ` (${bestScore[1].score}/10)`, kind: 'hypothesis' },
        dominantSentiment: sentTop ? `${sentTop[0]} (${U.pct(sentTop[1], agg.totalAnalyzed)}%)` : 'sem comentários analisados',
        engagementQuality: agg.engagementClass,
        mainShareTrigger: motivations.shares[0] ? motivations.shares[0].hypothesis : null,
        mainLimitation: coverageNote
      },
      diagnosis,
      evidence: {
        strongestExcerpt: hook.text ? { excerpt: hook.text, why: 'Primeiras linhas: ponto de decisão de leitura.' } : null,
        topCluster: topCluster ? { cluster: topCluster.name, pct: topCluster.pct, examples: topCluster.examples } : null,
        topDiscussion: agg.topDiscussion,
        weakestCriterion: { criterion: worstScore[0], score: worstScore[1].score, rationale: worstScore[1].rationale }
      },
      recommendations: {
        replicable: [
          `Mecanismo de gancho: ${hook.categories.filter(c => c !== 'indeterminado').join(', ') || 'nenhum mecanismo claro; criar um deliberadamente'}.`,
          `Formato ${raw.post.type} com ${raw.post.content.stats.paragraphs} parágrafos e ~${raw.post.content.stats.words} palavras.`,
          raw.post.content.cta.present ? `CTA do tipo "${raw.post.content.cta.type}".` : 'Considerar adicionar um CTA explícito.'
        ],
        doNotCopyLiterally: [
          'A história/dados pessoais do autor: replicar a ESTRUTURA, não o conteúdo.',
          hook.dependsOnAuthorReputation.value ? 'Elementos que dependem da audiência já construída do autor.' : 'O tema específico, que pode estar ligado a um momento particular.'
        ],
        improvements: [
          `Critério mais fraco: ${worstScore[0]} (${worstScore[1].score}/10). ${worstScore[1].rationale}`,
          agg.quality.genericRate.value > 50 ? 'Alta taxa de comentários genéricos: incluir pergunta específica no CTA para elevar a qualidade das respostas.' : 'Manter convites explícitos à contribuição para sustentar a taxa de comentários substantivos.'
        ],
        suggestedStructure: 'Gancho (1-2 linhas com o mecanismo identificado) → contexto pessoal breve → desenvolvimento em blocos curtos ou lista → conclusão com tese → CTA com pergunta específica.',
        interpretationRisks: [
          'Amostra limitada aos comentários carregados no DOM.',
          'Sentimento por regras não captura ironia e contexto com segurança.',
          'Notas 0-10 são heurísticas de estrutura, não medidas de qualidade real.',
          'Correlação entre elementos do post e engajamento não implica causalidade.'
        ],
        deepeningOpportunities: [
          'Ativar o modo IA para sentimento e clusterização semântica.',
          'Carregar mais comentários na página e atualizar a coleta.',
          'Comparar com outras publicações do mesmo autor para isolar o efeito da reputação.'
        ]
      },
      coverageNote
    };
  };

  /** Tema principal/secundários por frequência de termos significativos. */
  A.themes = function (raw, comments) {
    const stop = new Set(('que nao para com uma isso mais voce como muito por dos das sao esta foi ser tem mas seu sua the and that this with for you your are was have not but from they will can into about our ' +
      'https http www lnkd hubs bit link curso? com net org').split(' '));
    const freq = {};
    const stripUrls = t => String(t || '').replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/g, ' ');
    const addText = (t, w) => {
      for (const tok of U.normalizeForNlp(stripUrls(t)).split(/[^a-z0-9]+/)) {
        if (tok.length < 4 || stop.has(tok)) continue;
        freq[tok] = (freq[tok] || 0) + w;
      }
    };
    addText(raw.post.content.fullText, 3);
    raw.post.content.hashtags.forEach(h => addText(h.slice(1), 5));
    comments.slice(0, 100).forEach(c => addText(c.text, 1));
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
    return { main: top[0] || null, secondary: top.slice(1, 5), method: 'Frequência ponderada de termos (post ×3, hashtags ×5, comentários ×1). Aproximação lexical, não semântica.' };
  };

  // ------------------------------------------------------------------ pipeline

  A.analyze = function (raw, previousComments) {
    let comments = A.prepareComments(raw.comments);
    if (previousComments && previousComments.length) {
      comments = A.mergeComments(previousComments, comments);
    }
    for (const c of comments) {
      if (!c.sentiment || c.sentiment.source !== 'ai') c.sentiment = A.sentimentOf(c);
      if (!c.clusters || !c.clustersSource || c.clustersSource !== 'ai') { c.clusters = A.clustersOf(c); c.clustersSource = 'rules'; }
    }

    const language = U.detectLanguage(raw.post.content.fullText);
    const scores = A.scorePost(raw, comments);
    const hook = A.analyzeHook(raw);
    const agg = A.aggregate(raw, comments);
    const indices = A.indices(raw, agg, scores);
    const motivations = A.motivations(raw, agg);
    const report = A.buildReport(raw, agg, scores, hook, indices, motivations);
    const themes = A.themes(raw, comments);
    report.summary.theme = themes.main;

    return {
      mode: 'local',
      language,
      comments,
      scores,
      hook,
      themes,
      aggregates: agg,
      indices,
      motivations,
      report
    };
  };

  globalThis.__LPA_ANALYSIS = A;
  if (typeof module !== 'undefined' && module.exports) module.exports = A;
})();
