/**
 * content.js
 * Injetado sob demanda (chrome.scripting) APÓS selectors.js e utils.js.
 * Responsabilidade única: LER o DOM e devolver um payload bruto (RawExtraction).
 * Não clica, não navega, não carrega conteúdo automaticamente, não analisa.
 *
 * A última expressão do arquivo é o retorno de executeScript.
 */
(function () {
  const SEL = globalThis.__LPA_SELECTORS;
  const U = globalThis.__LPA_UTILS;

  const diagnostics = { selectorFailures: [], warnings: [], strategiesUsed: {} };

  /** Resolve a primeira estratégia de seletor que encontrar um elemento. */
  function q(root, key, list) {
    const strategies = list || SEL[key];
    if (!strategies) return null;
    for (let i = 0; i < strategies.length; i++) {
      try {
        const el = (root || document).querySelector(strategies[i]);
        if (el) {
          diagnostics.strategiesUsed[key] = i;
          return el;
        }
      } catch (e) { /* seletor inválido nesta versão do DOM */ }
    }
    diagnostics.selectorFailures.push(key);
    return null;
  }

  function qAll(root, key) {
    const strategies = SEL[key];
    for (let i = 0; i < strategies.length; i++) {
      try {
        const els = (root || document).querySelectorAll(strategies[i]);
        if (els.length) {
          diagnostics.strategiesUsed[key] = i;
          return Array.from(els);
        }
      } catch (e) { /* ignora */ }
    }
    diagnostics.selectorFailures.push(key);
    return [];
  }

  function textOf(el) {
    if (!el) return '';
    // innerText em nó clonado/desanexado degrada para textContent (perde quebras
    // de linha). O clone é anexado fora da viewport apenas durante a leitura.
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [role="button"], .visually-hidden, .a11y-text, script, style').forEach(n => n.remove());
    const host = document.createElement('div');
    // Precisa estar RENDERIZADO para innerText preservar quebras de linha
    // (display:none e visibility:hidden fazem innerText degradar/esvaziar).
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:600px;pointer-events:none;z-index:-1;';
    host.appendChild(clone);
    document.body.appendChild(host);
    let t;
    try { t = clone.innerText || clone.textContent || ''; }
    finally { host.remove(); }
    return U.cleanText(t);
  }

  function unavailable() {
    return { raw: null, normalized: null, precision: 'unavailable', available: false };
  }

  // ------------------------------------------- fallbacks estruturais (DOM novo)

  /** Inventário de componentes data-view-name presentes (para diagnóstico e calibração). */
  function collectViewNames() {
    const names = {};
    document.querySelectorAll('[data-view-name]').forEach(el => {
      const v = el.getAttribute('data-view-name');
      names[v] = (names[v] || 0) + 1;
    });
    return names;
  }

  /**
   * Localiza o bloco que concentra o maior volume de texto próprio dentro de scope,
   * excluindo subárvores indicadas (ex.: área de comentários). Independe de classes.
   */
  function largestTextBlock(scope, excludeEls) {
    const excluded = el => excludeEls.some(x => x === el || x.contains(el) || el.contains(x));
    let best = null, bestScore = 0;
    const len = el => (el.textContent || '').length; // textContent: sem reflow por nó
    const walk = el => {
      for (const ch of el.children) walk(ch);
      if (el.matches && el.matches('nav, header, footer, form, button, [role="button"], a, script, style')) return;
      if (excluded(el)) return;
      const total = len(el);
      if (total < 60) return;
      let childMax = 0;
      for (const ch of el.children) childMax = Math.max(childMax, len(ch));
      const own = total - childMax;          // texto que este nó agrega além do maior filho
      if (own < 40) return;                  // mero contêiner de passagem
      const score = total + own * 2;
      if (score > bestScore) { bestScore = score; best = el; }
    };
    try { walk(scope); } catch (e) { /* páginas enormes: aceita melhor parcial */ }
    return best;
  }

  /** Varre aria-labels e textos curtos por um rótulo de métrica; independe de classes. */
  function metricByLabel(scope, kwSource, excludeEls) {
    const excluded = el => (excludeEls || []).some(x => x === el || x.contains(el));
    // 1) aria-labels (mais confiáveis)
    for (const el of scope.querySelectorAll('[aria-label]')) {
      if (excluded(el)) continue;
      const m = U.adjacentCount(el.getAttribute('aria-label') || '', kwSource);
      if (m) return m;
    }
    // 2) textos curtos ("11 comentários", "85 compartilhamentos")
    for (const el of scope.querySelectorAll('button, span, a, li')) {
      if (excluded(el)) continue;
      const t = (el.textContent || '').trim();
      if (t.length > 60) continue;
      const m = U.adjacentCount(t, kwSource);
      if (m) return m;
    }
    return null;
  }

  /**
   * Detecção estrutural de comentários (DOM sem classes semânticas e sem
   * data-view-name): cada comentário possui exatamente um controle "Responder".
   * O contêiner do comentário é o maior ancestral que contém apenas esse controle.
   */
  function structuralComments(root) {
    const isReply = t => /^(responder|reply)$/i.test(String(t || '').trim());
    const all = Array.from(root.querySelectorAll('button, [role="button"], a'));
    const controls = all.filter(b => isReply(b.textContent) || isReply(b.getAttribute('aria-label')));
    if (!controls.length) return [];
    const containers = [];
    for (const btn of controls) {
      let node = btn.parentElement;
      let candidate = null;
      while (node && node !== root && node !== document.body) {
        let count = 0;
        for (const c of controls) if (node.contains(c)) count++;
        if (count === 1) { candidate = node; node = node.parentElement; }
        else break;
      }
      if (candidate) containers.push(candidate);
    }
    return containers;
  }

  const TIME_LINE_RE = /^\d+\s?(min|h|d|sem|m[êe]s(?:es)?|a|w|mo|y)$/i;
  const UI_LINE_RE = /^(gostei|responder|curtir|reagir|like|reply|traduzir|ver tradução|see translation|usuário verificado|verified user|premium|perfil|profile|autor|author|seguir|follow|carregar mais|exibir mais|load more)$/i;
  const REACTION_SUMMARY_RE = /^(gostei|amei|apoio|apoiei|celebrar|genial|interessante|like|love|support|celebrate|insightful|funny)[\s\d·•]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s\d·•]*$/iu;
  const COUNT_LINE_RE = /^(\d[\d.,]*)\s*(reaç(?:ão|ões|ao|oes)?|reactions?|respostas?|repl[a-z]*)$/i;

  /** Remove selos e sufixos de interface colados ao nome ("Fulano Usuário verificado Perfil 2º"). */
  function cleanPersonName(s) {
    return U.cleanText(s)
      .replace(/\s*(usuário verificado|verified user|premium|autor(?:a)? da publicação|autor|author)\b.*$/i, '')
      .replace(/\s*(perfil|profile)\b.*$/i, '')
      .replace(/\s*[•·].*$/, '')
      .replace(/\s*,\s*$/, '')
      .trim() || null;
  }

  /** Interpreta as linhas de um comentário estrutural: autor, headline, tempo, texto e reações. */
  function parseStructuralComment(el) {
    const lines = textOf(el).split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    let timeIdx = lines.findIndex(l => TIME_LINE_RE.test(l));
    let name = null, headline = null, timeLabel = null, text = '', reactionsLabel = null;

    if (timeIdx > 0) {
      timeLabel = lines[timeIdx];
      const headLines = lines.slice(0, timeIdx);
      const withDegree = headLines.find(l => /[•·]\s*\d+º/.test(l));
      name = cleanPersonName(withDegree ? withDegree.split(/[•·]/)[0] : headLines[0]);
      headline = headLines.filter(l => !name || !l.startsWith(name)).sort((a, b) => b.length - a.length)[0] || null;
      const bodyLines = lines.slice(timeIdx + 1)
        .filter(l => {
          const cm = l.match(COUNT_LINE_RE);
          if (cm) {
            if (/reaç|reaction/i.test(cm[2])) reactionsLabel = reactionsLabel || cm[1];
            return false; // linhas "1 reação"/"2 respostas" são metadados, não texto
          }
          return true;
        })
        .filter(l => !UI_LINE_RE.test(l))
        .filter(l => !TIME_LINE_RE.test(l))
        .filter(l => !/^\d+$/.test(l))
        .filter(l => !(l.length <= 24 && REACTION_SUMMARY_RE.test(l)));
      text = bodyLines.join('\n').trim();
    } else {
      // Defesa: bloco achatado em 1-2 linhas (sem quebras). Segmenta pelo token de tempo.
      const flat = lines.join(' ');
      const tm = flat.match(/\d+\s?(?:min|h|d|sem|m[êe]s(?:es)?|a|w|mo|y)\b/i);
      if (tm && tm.index > 0) {
        timeLabel = tm[0];
        const head = flat.slice(0, tm.index);
        text = flat.slice(tm.index + tm[0].length).replace(/^[•·\s]+/, '').trim();
        name = U.duplicatedPrefix(head)
          || cleanPersonName(head.split(/usuário verificado|verified user|premium|perfil|profile|seguindo|following|[•·]/i)[0])
          || null;
        if (name) {
          const hIdx = head.lastIndexOf(name);
          if (hIdx > 0) {
            headline = head.slice(hIdx + name.length)
              .replace(/^[\s•·]*\d*º?\s*(e\s*\+)?\s*/i, '')
              .replace(/^(seguindo|following)\s*/i, '').trim() || null;
          }
        }
      } else {
        text = lines.filter(l => !UI_LINE_RE.test(l)).join('\n').trim();
      }
    }
    name = name ? cleanPersonName(name) : null;

    if (!name && !text) return null;
    return { name, headline, timeLabel, text, reactionsLabel };
  }

  // ---------------------------------------------------------------- publicação

  function extractPostId() {
    const urn = (location.href.match(/urn(?::|%3A)li(?::|%3A)(?:activity|share|ugcPost)(?::|%3A)(\d+)/i) || [])[1];
    if (urn) return urn;
    // URLs /posts/ carregam o ID no slug: ...-share-7487463887773270016-tHQK/
    const slug = (location.pathname.match(/-(?:share|activity|ugcpost)-(\d{10,})/i) || location.pathname.match(/-(\d{15,})(?:-[a-z0-9]+)?\/?$/i) || [])[1];
    if (slug) return slug;
    const el = document.querySelector('[data-urn*="activity"], [data-id*="activity"]');
    const attr = el ? (el.getAttribute('data-urn') || el.getAttribute('data-id')) : '';
    return (attr.match(/activity:(\d+)/) || [])[1] || null;
  }

  function detectPostType(root, hasRepost) {
    const found = [];
    for (const [type, sels] of Object.entries(SEL.media)) {
      if (q(root, 'media.' + type, sels)) found.push(type);
    }
    const text = found.length ? found : [];
    let primary = 'text';
    if (hasRepost) primary = 'repost';
    else if (text.includes('video')) primary = 'video';
    else if (text.includes('document')) primary = 'document';
    else if (text.includes('poll')) primary = 'poll';
    else if (text.includes('article')) primary = 'article';
    else if (text.includes('image')) primary = 'image';
    return { primary, mediaDetected: found };
  }

  function extractAuthor(root, commentEls) {
    const container = q(root, 'authorContainer') || root;
    const hasContainer = container !== root;
    const nameEl = q(container, 'authorName');
    const headEl = q(container, 'authorHeadline');
    const linkEl = q(container, 'authorLink');
    const badgeText = textOf(q(container, 'authorBadges'));

    let name = textOf(nameEl) || null;
    let headline = textOf(headEl) || null;
    let profileUrl = linkEl ? linkEl.href.split('?')[0] : null;
    let urlSource = profileUrl ? 'selector' : null;

    // O slug da URL /posts/{slug}_... identifica o autor de forma determinística
    const slug = (location.pathname.match(/\/posts\/([^_/]+)_/) || [])[1] || null;
    const inComments = el => (commentEls || []).some(x => x === el || x.contains(el));

    if (!name || !profileUrl) {
      const links = Array.from(root.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')).filter(a => !inComments(a));
      let chosen = null;
      if (slug) {
        // Só aceita link cujo href corresponda ao slug do autor declarado na URL
        chosen = links.find(a => a.pathname && a.pathname.toLowerCase().includes('/in/' + slug.toLowerCase()))
          || links.find(a => a.pathname && a.pathname.toLowerCase().includes('/company/' + slug.toLowerCase()));
      } else {
        chosen = links.find(a => U.cleanText(a.innerText || a.textContent).length > 1);
      }
      if (chosen) {
        const lines = U.cleanText(chosen.innerText || chosen.textContent).split('\n').filter(Boolean);
        if (!name && lines[0]) { name = lines[0]; diagnostics.strategiesUsed.author = slug ? 'slug-matched-link' : 'fallback-profile-link'; }
        if (!headline && lines[1]) headline = lines[1];
        if (!profileUrl) { profileUrl = chosen.href.split('?')[0]; urlSource = slug ? 'link-slug' : 'link-text'; }
      }
    }

    // Nome via metadados da página (og:title: "Fulano no LinkedIn: ...")
    if (!name) {
      const og = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
      const title = (og && og.content) || document.title || '';
      const mt = title.match(/^(.{2,80}?)\s+(?:no|on|en|sur|auf)\s+LinkedIn/i) || title.match(/^Post de\s+(.{2,80}?)\s*[:|]/i);
      if (mt) { name = U.cleanText(mt[1]); diagnostics.strategiesUsed.author = 'og-title'; }
    }

    // URL inferida do slug quando nenhum link corresponde (pode ser /company/ em páginas de empresa)
    if (!profileUrl && slug) {
      profileUrl = 'https://www.linkedin.com/in/' + slug + '/';
      urlSource = 'inferred-from-slug';
      diagnostics.warnings.push('URL do perfil do autor INFERIDA do slug da publicação (' + slug + '). Se o autor for uma página de empresa, o caminho correto é /company/.');
    }

    const followers = /seguidor|follower/i.test(badgeText)
      ? U.parseCountFromText(badgeText)
      : unavailable();

    const connMatch = badgeText.match(/(\d)\s*[ºo°]?\s*(?:grau|degree)/i) || (textOf(headEl).match(/•\s*(\d)[ºo°]/) || null);

    return {
      name,
      profileUrl,
      urlSource,
      headline,
      company: null, // raramente separado da headline no DOM; mantido explícito como indisponível
      connectionDegree: connMatch ? connMatch[1] + 'º' : null,
      followers,
      // Sem o contêiner específico do autor, um selo de qualquer comentarista no
      // mesmo escopo geraria falso positivo; melhor não afirmar.
      verified: hasContainer ? !!container.querySelector('svg[aria-label*="erificado" i], svg[aria-label*="erified" i]') : false
    };
  }

  function extractContent(root, commentEls) {
    let textEl = q(root, 'postText');
    let fullText = textOf(textEl);
    let headerInfo = null;

    // Fallback estrutural (DOM novo): bloco que concentra mais texto, fora dos comentários
    if (!fullText) {
      const fb = largestTextBlock(root, commentEls || []);
      if (fb) {
        textEl = fb;
        fullText = textOf(fb);
        diagnostics.strategiesUsed.postText = 'fallback-largest-block';
        // O bloco pode arrastar o cabeçalho do post ("Publicação no feed NOME • ...")
        const sb = U.stripFeedBoilerplate(fullText);
        if (sb.stripped) {
          fullText = sb.text;
          headerInfo = { author: sb.author, timeLabel: sb.timeLabel };
          diagnostics.strategiesUsed.postText = 'fallback-largest-block+strip-header';
        }
        diagnostics.warnings.push('Texto do post identificado por heurística estrutural (DOM novo). Confira na aba Publicação se o texto capturado corresponde ao post.');
      }
    }

    const truncated = !!q(root, 'seeMoreButton') || /…\s*mais$|\.\.\.\s*more$/i.test(fullText);
    const lines = fullText.split('\n');
    const hookText = fullText.slice(0, 210).split('\n').slice(0, 3).join('\n');

    const imgs = Array.from(root.querySelectorAll('.update-components-image img, .feed-shared-image img'));
    const mediaAlt = imgs.map(i => U.cleanText(i.alt)).filter(Boolean);

    const links = U.extractUrls(fullText)
      .concat(Array.from((textEl || root).querySelectorAll('a[href^="http"]'))
        .map(a => a.href)
        .filter(h => !/linkedin\.com\/(in|company|feed)\//.test(h)));

    const ctaPatterns = [
      { type: 'comentar', re: /coment[ae]|comment below|deixe? (?:seu|um) coment/i },
      { type: 'link', re: /link (?:na|nos|in the|abaixo|below|coment[aá]rios|first comment)/i },
      { type: 'seguir', re: /siga(?:-me)?|me segue|follow (?:me|for)/i },
      { type: 'compartilhar', re: /compartilh[ae]|repost|share (?:this|with)/i },
      { type: 'download', re: /baix[ae]|download|material gratuito|planilha|template|e-?book/i },
      { type: 'inscrição', re: /inscrev|newsletter|cadastr|sign ?up|subscribe/i },
      { type: 'pergunta', re: /\?\s*$/m }
    ];
    const cta = ctaPatterns.find(p => p.re.test(fullText));

    return {
      fullText,
      truncatedInDom: truncated,
      hookText,
      stats: {
        chars: fullText.length,
        words: U.countWords(fullText),
        paragraphs: U.countParagraphs(fullText),
        lines: lines.length
      },
      links: Array.from(new Set(links)),
      hashtags: U.extractHashtags(fullText),
      mentions: U.extractMentions(fullText),
      emojis: U.extractEmojis(fullText),
      mediaAltTexts: mediaAlt,
      mediaDescription: mediaAlt.join(' | ') || null,
      cta: { present: !!cta, type: cta ? cta.type : null },
      headerInfo
    };
  }

  function extractRepost(root) {
    const wrapper = q(root, 'repostWrapper');
    if (!wrapper) return null;
    const originalAuthor = extractAuthor(wrapper);
    const originalTextEl = q(wrapper, 'postText');
    return {
      originalAuthor,
      originalText: textOf(originalTextEl),
      note: 'Métricas da publicação original não são exibidas dentro do repost pelo LinkedIn; apenas o conteúdo é replicado.'
    };
  }

  // ------------------------------------------------------------------ métricas

  function extractMetrics(root, commentEls) {
    const social = q(root, 'socialCounts') || root;

    const reactionsEl = q(social, 'reactionsCount');
    const reactions = reactionsEl
      ? U.parseCountFromText(reactionsEl.getAttribute('aria-label') || textOf(reactionsEl) || reactionsEl.textContent)
      : unavailable();

    // Tipos de reação: o LinkedIn só mostra os ÍCONES dos tipos mais comuns; contagens
    // individuais exigem abrir o modal. Registramos presença, nunca inventamos contagem.
    const icons = qAll(social, 'reactionIcons');
    const typeMap = { like: 'gostei', celebrate: 'celebrar', support: 'apoio', love: 'amei', insightful: 'interessante', funny: 'engraçado', curious: 'curioso' };
    const byType = {};
    icons.forEach(img => {
      const alt = (img.alt || img.getAttribute('data-test-reactions-icon-type') || '').toLowerCase();
      for (const [en, pt] of Object.entries(typeMap)) {
        if (alt.includes(en) || alt.includes(pt)) byType[pt] = { present: true, count: unavailable() };
      }
    });

    const commentsEl = q(social, 'commentsCount');
    const comments = commentsEl
      ? U.parseCountFromText(commentsEl.getAttribute('aria-label') || textOf(commentsEl))
      : unavailable();

    const repostsEl = q(social, 'repostsCount');
    const reposts = repostsEl
      ? U.parseCountFromText(repostsEl.getAttribute('aria-label') || textOf(repostsEl))
      : unavailable();

    const viewsEl = q(root.ownerDocument || document, 'viewsCount');
    let views = viewsEl ? U.parseCountFromText(textOf(viewsEl)) : unavailable();

    // Fallbacks independentes de classe (DOM novo): adjacência número+palavra em
    // rótulos acessíveis e textos curtos, ignorando a área de comentários (para
    // não capturar contagens de reações/respostas de comentários individuais).
    const KW = {
      reactions: 'reaç\\w*|reactions?|curtidas?|likes?|gostaram',
      comments: 'coment[aá]rios?|comments?',
      reposts: 'compartilhamentos?|reposts?|shares?|republica\\w*',
      views: 'impress\\w*|visualiza\\w*|views?|exibi\\w*'
    };
    let reactionsOut = reactions, commentsOut = comments, repostsOut = reposts;
    if (!reactionsOut.available) {
      const m = metricByLabel(root, KW.reactions, commentEls);
      if (m) { reactionsOut = m; diagnostics.strategiesUsed.reactionsCount = 'fallback-aria'; }
    }
    if (!reactionsOut.available) {
      // Prova social sem a palavra "reações": "Fulano e outras 89 pessoas"
      const excluded = el => (commentEls || []).some(x => x === el || x.contains(el));
      outer:
      for (const sel of ['[aria-label]', 'button, span, a, li']) {
        for (const el of root.querySelectorAll(sel)) {
          if (excluded(el)) continue;
          const t = sel === '[aria-label]' ? el.getAttribute('aria-label') : (el.textContent || '').trim();
          if (!t || t.length > 120) continue;
          const r = U.reactionsPhraseCount(t);
          if (r) { reactionsOut = r; diagnostics.strategiesUsed.reactionsCount = 'fallback-social-proof'; break outer; }
        }
      }
    }
    if (!commentsOut.available) {
      const m = metricByLabel(root, KW.comments, commentEls);
      if (m) { commentsOut = m; diagnostics.strategiesUsed.commentsCount = 'fallback-aria'; }
    }
    if (!repostsOut.available) {
      const m = metricByLabel(root, KW.reposts, commentEls);
      if (m) { repostsOut = m; diagnostics.strategiesUsed.repostsCount = 'fallback-aria'; }
    }
    if (!views.available) {
      const m = metricByLabel(root, KW.views, commentEls);
      if (m) { views = m; diagnostics.strategiesUsed.viewsCount = 'fallback-aria'; }
    }

    return { reactions: reactionsOut, byType, comments: commentsOut, reposts: repostsOut, views };
  }

  // --------------------------------------------------------------- comentários

  function commentLevel(el, allComments) {
    let level = 0;
    let parent = el.parentElement;
    while (parent && level < 6) {
      if (allComments.includes(parent)) level++;
      // contêineres de resposta também indicam profundidade
      if (parent.className && /replies-container|comments-reply/i.test(parent.className)) level = Math.max(level, 1);
      parent = parent.parentElement;
    }
    return Math.min(level, 2);
  }

  function findParentId(el, byElement) {
    let parent = el.parentElement;
    while (parent) {
      if (byElement.has(parent)) return byElement.get(parent);
      parent = parent.parentElement;
    }
    return null;
  }

  function extractComments(root) {
    let els = qAll(document, 'commentItem');
    let structural = false;
    if (!els.length) {
      els = structuralComments(root);
      if (els.length) {
        structural = true;
        diagnostics.strategiesUsed.commentItem = 'fallback-reply-anchors';
        diagnostics.warnings.push('Comentários identificados por heurística estrutural (âncora "Responder"). Hierarquia de respostas pode não ser detectada neste modo.');
      }
    }
    const byElement = new Map();
    const results = [];

    els.forEach(el => {
      let author = '', text = '', headlineFb = null, timeFb = null, reactFb = null;

      if (structural) {
        const parsed = parseStructuralComment(el);
        if (!parsed) return;
        author = parsed.name || '';
        text = parsed.text || '';
        headlineFb = parsed.headline;
        timeFb = parsed.timeLabel;
        reactFb = parsed.reactionsLabel;
      } else {
        const nameEl = q(el, 'commentAuthorName');
        const textEl = q(el, 'commentText');
        author = textOf(nameEl);
        text = textOf(textEl);

        // Fallbacks pontuais quando só parte dos seletores falha
        if (!author) {
          const link = Array.from(el.querySelectorAll('a[href*="/in/"], a[href*="/company/"]'))
            .find(a => U.cleanText(a.innerText || a.textContent).length > 1);
          if (link) author = (U.cleanText(link.innerText || link.textContent).split('\n')[0] || '').trim();
        }
        if (!text) {
          const parsed = parseStructuralComment(el);
          if (parsed) { text = parsed.text; headlineFb = headlineFb || parsed.headline; timeFb = timeFb || parsed.timeLabel; reactFb = reactFb || parsed.reactionsLabel; }
        }
      }

      if (!author && !text) return;

      const id = el.getAttribute('data-id') || 'c_' + U.hash(author + '|' + text.slice(0, 120));
      if (byElement.has(el)) return;
      byElement.set(el, id);
      results.push({ el, id, author, text, headlineFb, timeFb, reactFb });
    });

    const comments = results.map(({ el, id, author, text, headlineFb, timeFb, reactFb }) => {
      const headline = textOf(q(el, 'commentAuthorHeadline')) || headlineFb || null;
      let linkEl = q(el, 'commentAuthorLink');
      if (!linkEl) {
        linkEl = Array.from(el.querySelectorAll('a[href*="/in/"], a[href*="/company/"]'))
          .find(a => U.cleanText(a.innerText || a.textContent).length > 1)
          || el.querySelector('a[href*="/in/"], a[href*="/company/"]');
      }
      let authorName = author || null;
      if (!authorName && linkEl) {
        authorName = cleanPersonName((U.cleanText(linkEl.innerText || linkEl.textContent).split('\n')[0] || ''))
          || U.nameFromProfileSlug(linkEl.href);
      }
      // Menções no DOM novo são nomes puros em links (sem "@"): considera como
      // menção todo link de perfil cujo texto apareça no corpo do comentário.
      const linkMentions = Array.from(el.querySelectorAll('a[href*="/in/"], a[href*="/company/"]'))
        .map(a => cleanPersonName((U.cleanText(a.innerText || a.textContent).split('\n')[0] || '')))
        .filter(n => n && n !== authorName && text && text.includes(n));
      const timeEl = q(el, 'commentTime');
      const reactEl = q(el, 'commentReactions');
      const repliesEl = q(el, 'commentRepliesCount');
      const badge = textOf(q(el, 'commentAuthorBadge'));
      const level = commentLevel(el, results.map(r => r.el));

      return {
        id,
        parentId: level > 0 ? findParentId(el, byElement) : null,
        level,
        author: {
          name: authorName,
          headline: headline || null,
          profileUrl: linkEl && linkEl.href ? linkEl.href.split('?')[0] : null
        },
        text,
        timeLabel: textOf(timeEl) || timeFb || null,
        reactions: (function () {
          const viaSel = reactEl ? U.parseCountFromText(reactEl.getAttribute('aria-label') || textOf(reactEl)) : unavailable();
          if (viaSel.available) return viaSel;
          return reactFb ? U.parseCount(reactFb) : viaSel;
        })(),
        repliesCount: repliesEl ? U.parseCountFromText(textOf(repliesEl)) : unavailable(),
        flags: {
          byPostAuthor: /autor|author/i.test(badge),
          highlighted: /destaque|pinned|featured/i.test(el.className + ' ' + badge)
        },
        links: U.extractUrls(text),
        mentions: Array.from(new Set(U.extractMentions(text).concat(linkMentions))),
        hashtags: U.extractHashtags(text),
        emojis: U.extractEmojis(text)
      };
    });

    return { comments, elements: results.map(r => r.el) };
  }

  // ---------------------------------------------------------------------- main

  diagnostics.viewNames = collectViewNames();

  let postRoot = q(document, 'postRoot');

  // Fallback: localizar um elemento inequívoco de conteúdo e subir até o contêiner
  if (!postRoot) {
    const anchor = document.querySelector(
      '.update-components-text, .social-details-social-counts, .update-components-actor, .feed-shared-inline-show-more-text'
    );
    if (anchor) {
      postRoot = anchor.closest('[data-urn], [data-id], article, .feed-shared-update-v2, .fie-impression-container')
        || document.querySelector('main')
        || document.body;
      diagnostics.strategiesUsed.postRoot = 'fallback-anchor';
      diagnostics.warnings.push('Contêiner da publicação identificado por fallback (âncora de conteúdo). O DOM do LinkedIn pode ter mudado; considere atualizar selectors.js (chave postRoot).');
    }
  }

  if (!postRoot) {
    // Sonda: o que existe nesta página? (ajuda a diagnosticar mudanças de DOM)
    const probe = {};
    ['main', 'article', '[data-urn]', '[data-id]', '[data-view-name]', 'div.feed-shared-update-v2', '.fie-impression-container',
     '.update-components-text', '.update-components-actor', '.social-details-social-counts', 'video']
      .forEach(s => { try { probe[s] = document.querySelectorAll(s).length; } catch (e) { probe[s] = 'erro'; } });
    return {
      ok: false,
      error: 'POST_NOT_FOUND',
      message: 'Nenhuma publicação foi encontrada nesta página. Abra a URL de uma publicação específica do LinkedIn.',
      probe,
      viewNames: diagnostics.viewNames,
      readyState: document.readyState,
      diagnostics
    };
  }

  // Ordem importa: identificar comentários primeiro permite excluí-los do
  // fallback estrutural do texto do post.
  const commentsExtraction = extractComments(postRoot);
  const comments = commentsExtraction.comments;

  const repost = extractRepost(postRoot);
  const type = detectPostType(postRoot, !!repost);
  const content = extractContent(postRoot, commentsExtraction.elements);
  const metrics = extractMetrics(postRoot, commentsExtraction.elements);
  const author = extractAuthor(postRoot, commentsExtraction.elements);

  // Fusão: dados do cabeçalho recuperados no strip do boilerplate são mais
  // confiáveis que fallbacks por link sem validação de slug.
  if (content.headerInfo && content.headerInfo.author) {
    const h = content.headerInfo.author;
    if (h.name && author.name !== h.name) {
      if (author.name && author.urlSource === 'link-text') {
        author.profileUrl = null; // URL veio de um link genérico que não corresponde ao autor do cabeçalho
        diagnostics.warnings.push('URL de perfil descartada: o link encontrado não corresponde ao autor identificado no cabeçalho do post.');
      }
      author.name = h.name;
      diagnostics.strategiesUsed.author = 'header-boilerplate';
    }
    if (!author.headline && h.headline) author.headline = h.headline;
  }
  delete content.headerInfo;

  // Último recurso para o NOME do autor, em duas etapas que não dependem de classes:
  // 1) cabeçalho "Publicação no feed NOME • ..." no prefixo do texto da raiz;
  // 2) correspondência determinística com o slug da URL: a primeira linha curta
  //    cuja normalização é igual ao slug (/posts/diegoivo_... -> "Diego Ivo").
  if (!author.name) {
    const rootText = textOf(postRoot);
    const sb = U.stripFeedBoilerplate(rootText.slice(0, 800));
    if (sb.stripped && sb.author && sb.author.name) {
      author.name = cleanPersonName(sb.author.name);
      if (!author.headline && sb.author.headline) author.headline = sb.author.headline;
      diagnostics.strategiesUsed.author = 'header-prefix';
    }
    if (!author.name) {
      const slug = (location.pathname.match(/\/posts\/([^_/]+)_/) || [])[1];
      if (slug) {
        const target = U.slugify(slug);
        const hit = rootText.split('\n').map(s => s.trim())
          .filter(l => l && l.length <= 60)
          .find(l => {
            const ls = U.slugify(l);
            return ls.length >= 5 && (ls === target || target.startsWith(ls));
          });
        if (hit) {
          author.name = cleanPersonName(hit);
          diagnostics.strategiesUsed.author = 'slug-name-match';
          // Headline: primeira linha informativa logo após o nome no cabeçalho
          if (!author.headline) {
            const all = rootText.split('\n').map(s => s.trim());
            const at = all.findIndex(l => l === hit);
            for (const l of all.slice(at + 1, at + 6)) {
              if (!l || /^([•·]|seguindo|following|\d+\s?(min|h|d|sem|m[êe]s|a)\b|editado|edited|agende|ver perfil|visit profile)/i.test(l)) continue;
              if (l.length >= 12 && l.length <= 140) { author.headline = l; break; }
              break;
            }
          }
        }
      }
    }
  }
  delete author.urlSource;

  if (content.truncatedInDom) {
    diagnostics.warnings.push('O texto da publicação está truncado ("…mais"). Clique em "ver mais" na página e atualize a coleta para capturar o texto completo.');
  }

  const declared = metrics.comments.available ? metrics.comments.normalized : null;
  const loaded = comments.length;
  let hasLoadMore = !!q(document, 'loadMoreComments');
  if (!hasLoadMore) {
    // Detecção estrutural: exige o termo de comentários/respostas para não casar
    // com o "ver mais" do texto do post.
    hasLoadMore = Array.from(document.querySelectorAll('button, [role="button"]'))
      .some(b => /(carregar|exibir|ver|mostrar|load|show|see)\s+(mais|more)\s+(coment\w*|comments?|respostas?|repl\w*)|(mais|more)\s+(coment\w*|comments?)\b/i
        .test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')));
  }

  const coverage = {
    commentsLoaded: loaded,
    commentsDeclared: declared,
    declaredPrecision: metrics.comments.precision,
    ratio: declared ? Math.min(1, Math.round((loaded / declared) * 1000) / 1000) : (loaded > 0 ? null : (declared === 0 ? 1 : null)),
    // A contagem declarada é a referência: atingida, a amostra é considerada
    // completa mesmo que exista botão de carregar mais (que pode ser falso positivo).
    complete: declared != null ? loaded >= declared : !hasLoadMore,
    moreAvailableInPage: hasLoadMore
  };

  // Retorno de executeScript (última expressão)
  return {
    ok: true,
    meta: {
      url: location.href.split('?')[0],
      postId: extractPostId(),
      collectedAt: new Date().toISOString(),
      pageTitle: document.title
    },
    post: {
      type: type.primary,
      mediaDetected: type.mediaDetected,
      author,
      content,
      repost
    },
    metrics,
    comments,
    coverage,
    diagnostics
  };
})();
