/**
 * panel.js
 * Controlador do side panel: estados da UI, orquestração da análise,
 * consentimento do modo IA e renderização das abas.
 */
(function () {
  const U = globalThis.__LPA_UTILS;
  const A = globalThis.__LPA_ANALYSIS;
  const AI = globalThis.__LPA_AI;
  const EXP = globalThis.__LPA_EXPORT;

  const $ = id => document.getElementById(id);
  const esc = U.escapeHtml;

  let state = null;          // { raw, analysis }
  let sessionApiKey = '';    // chave não persistida (vale enquanto o painel viver)
  let busy = false;

  // ------------------------------------------------------------------ estados

  function setStatus(cls, text) {
    const el = $('page-status');
    el.className = 'status status-' + cls;
    el.textContent = text;
  }

  function notice(kind, html) {
    const el = $('notice');
    if (!html) { el.hidden = true; return; }
    el.className = 'notice ' + (kind || '');
    el.innerHTML = html;
    el.hidden = false;
  }

  function setBusy(b, label) {
    busy = b;
    $('btn-analyze').disabled = b || !pageOk;
    $('btn-refresh').disabled = b || !state || !pageOk;
    $('btn-clear').disabled = b || !state;
    if (b) notice('busy', esc(label || 'Processando…'));
  }

  let pageOk = false;

  async function send(msg) {
    return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
  }

  async function checkPage() {
    const page = await send({ type: 'CHECK_PAGE' });
    switch (page && page.status) {
      case 'POST_PAGE':
        pageOk = true;
        setStatus('ok', 'Publicação detectada');
        break;
      case 'LINKEDIN_NOT_POST':
        pageOk = false;
        setStatus('warn', 'LinkedIn, mas não é a URL de uma publicação');
        break;
      case 'NOT_LINKEDIN':
        pageOk = false;
        setStatus('bad', 'Página incompatível (não é LinkedIn)');
        break;
      default:
        pageOk = false;
        setStatus('bad', 'Nenhuma aba ativa detectada');
    }
    if (!busy) {
      $('btn-analyze').disabled = !pageOk;
      $('btn-refresh').disabled = !state || !pageOk;
      $('btn-clear').disabled = !state;
    }
  }

  // ------------------------------------------------------------- configuração

  async function loadSettings() {
    const { lpa_settings } = await chrome.storage.local.get('lpa_settings');
    const s = lpa_settings || {};
    $('ai-enabled').checked = !!s.aiEnabled;
    $('ai-provider').value = s.provider || 'anthropic';
    $('ai-model').value = s.model || '';
    $('ai-persist').checked = !!s.persistKey;
    if (s.persistKey && s.apiKeyEncoded) {
      try { $('ai-key').value = atob(s.apiKeyEncoded); } catch (e) { /* ignora */ }
    }
    $('ai-model').placeholder = AI.PROVIDERS[$('ai-provider').value].defaultModel;
  }

  async function saveSettings() {
    const persist = $('ai-persist').checked;
    await chrome.storage.local.set({
      lpa_settings: {
        aiEnabled: $('ai-enabled').checked,
        provider: $('ai-provider').value,
        model: $('ai-model').value.trim(),
        persistKey: persist,
        // Base64 é apenas ofuscação, não criptografia (documentado no README e na UI).
        apiKeyEncoded: persist ? btoa($('ai-key').value.trim()) : null
      }
    });
    if (!persist) sessionApiKey = $('ai-key').value.trim();
  }

  function aiConfig() {
    const provider = $('ai-provider').value;
    return {
      enabled: $('ai-enabled').checked,
      provider,
      model: $('ai-model').value.trim() || AI.PROVIDERS[provider].defaultModel,
      apiKey: $('ai-key').value.trim() || sessionApiKey
    };
  }

  // ------------------------------------------------------------ fluxo de análise

  async function runExtraction() {
    const payload = await send({ type: 'EXTRACT' });
    if (!payload || !payload.ok) {
      const map = {
        INVALID_PAGE: 'A aba ativa não é uma publicação do LinkedIn.',
        POST_NOT_FOUND: 'Publicação não encontrada no DOM. A página pode ainda estar carregando; aguarde e tente novamente.',
        INJECTION_FAILED: 'Erro de leitura: não foi possível injetar o leitor na página. Recarregue a aba do LinkedIn.',
        EMPTY_RESULT: 'A extração não retornou dados.'
      };
      let msg = map[payload && payload.error] || (payload && payload.message) || 'Erro desconhecido na extração.';
      if (payload && payload.error === 'POST_NOT_FOUND' && payload.probe) {
        const found = Object.entries(payload.probe).filter(([, n]) => n > 0).map(([s, n]) => `${s}: ${n}`).join(' · ');
        const vn = payload.viewNames && Object.keys(payload.viewNames).length
          ? '; view-names: ' + Object.entries(payload.viewNames).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}:${v}`).join(' · ')
          : '';
        msg += ` [diagnóstico: readyState=${payload.readyState}; encontrados na página: ${found || 'nenhum seletor conhecido'}${vn}]`;
      }
      throw new Error(msg);
    }
    return payload;
  }

  async function analyze(isRefresh) {
    if (busy) return;
    setBusy(true, isRefresh ? 'Atualizando coleta…' : 'Lendo a publicação…');
    try {
      const raw = await runExtraction();
      setBusy(true, 'Analisando (modo local)…');
      const previous = isRefresh && state ? state.analysis.comments : null;
      const analysis = A.analyze(raw, previous);
      // Cobertura pós-merge (a coleta atual pode ter menos itens no DOM que a união)
      raw.coverage.commentsLoaded = analysis.comments.length;
      if (raw.coverage.commentsDeclared != null) {
        raw.coverage.ratio = Math.min(1, Math.round((analysis.comments.length / raw.coverage.commentsDeclared) * 1000) / 1000);
      }
      state = { raw, analysis };

      const cfg = aiConfig();
      state.aiStatus = null;
      if (cfg.enabled) {
        if (!cfg.apiKey) {
          state.aiStatus = { attempted: false, ok: false, provider: cfg.provider, model: cfg.model, error: 'Modo IA ativado, mas sem chave de API.' };
        } else if (cfg.provider === 'openai' && !/^sk-/.test(cfg.apiKey)) {
          state.aiStatus = { attempted: false, ok: false, provider: cfg.provider, model: cfg.model, error: 'O valor informado não parece uma chave de API da OpenAI (elas começam com "sk-"). Gere uma em platform.openai.com/api-keys. Atenção: a assinatura do ChatGPT não inclui acesso à API.' };
        } else if (cfg.provider === 'anthropic' && !/^sk-ant-/.test(cfg.apiKey)) {
          state.aiStatus = { attempted: false, ok: false, provider: cfg.provider, model: cfg.model, error: 'O valor informado não parece uma chave de API da Anthropic (elas começam com "sk-ant-"). Gere uma em console.anthropic.com.' };
        } else {
          const consented = await askConsent(cfg, raw);
          if (!consented) {
            state.aiStatus = { attempted: false, ok: false, provider: cfg.provider, model: cfg.model, error: 'Consentimento não concedido; mantido o modo local.' };
          } else {
            setBusy(true, 'Enviando para o provedor de IA…');
            state.aiStatus = await runAi(cfg);
          }
        }
      }

      await send({ type: 'SAVE_STATE', state });
      render();

      // Avisos consolidados
      const warns = [];
      const cov = raw.coverage;
      if (!cov.complete) {
        warns.push(`Coleta parcial: <b>${cov.commentsLoaded}</b> comentários coletados` +
          (cov.commentsDeclared != null ? ` de <b>${cov.commentsDeclared}</b> declarados (${cov.ratio != null ? (cov.ratio * 100).toFixed(1) + '%' : 'cobertura desconhecida'})` : '') +
          '. Role a página, clique em "Carregar mais comentários" no LinkedIn e use <b>Atualizar coleta</b>.');
      }
      raw.diagnostics.warnings.forEach(w => warns.push(esc(w)));
      let aiFailed = false;
      if (state.aiStatus && !state.aiStatus.ok) {
        aiFailed = true;
        warns.unshift('<b>Modo IA não aplicado</b> (' + esc(state.aiStatus.provider) + ' · ' + esc(state.aiStatus.model) + '): ' +
          esc(state.aiStatus.error || 'erro desconhecido') + ' Os resultados abaixo usam o modo local. O erro também fica registrado no JSON exportado (campo aiStatus).');
      }
      if (raw.diagnostics.selectorFailures.length >= 5) {
        const vn = raw.diagnostics.viewNames
          ? Object.entries(raw.diagnostics.viewNames).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}:${v}`).join(' · ')
          : 'nenhum';
        warns.push(`DOM em formato novo: ${raw.diagnostics.selectorFailures.length} chaves de seletor falharam e a extração usou heurísticas estruturais. ` +
          `Se algum campo veio errado/vazio, envie este bloco para ajuste fino dos seletores: <span style="font-family:var(--mono);font-size:10px">[view-names: ${esc(vn)}]</span>`);
      }
      notice(warns.length ? (aiFailed ? 'bad' : 'warn') : null, warns.join('<br><br>'));
    } catch (e) {
      notice('bad', esc(e.message || String(e)));
    } finally {
      setBusy(false);
      checkPage();
    }
  }

  // ------------------------------------------------------------------ modo IA

  function askConsent(cfg, raw) {
    return new Promise(resolve => {
      const info = AI.consentInfo(cfg, raw);
      $('consent-body').innerHTML =
        `<p><b>Serviço:</b> ${esc(info.service)}<br><b>Modelo:</b> <code>${esc(info.model)}</code></p>
         <p><b>Será enviado:</b></p><ul>${info.dataSent.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
         <p><b>Não será enviado:</b></p><ul>${info.dataNotSent.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
         <p><b>Finalidade:</b> ${esc(info.purpose)}</p>`;
      const dlg = $('consent-dialog');
      const ok = $('consent-ok'), cancel = $('consent-cancel');
      const done = v => { dlg.close(); ok.onclick = cancel.onclick = null; resolve(v); };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      dlg.showModal();
    });
  }

  async function runAi(cfg) {
    const status = { attempted: true, ok: false, provider: cfg.provider, model: cfg.model, error: null };
    const host = AI.PROVIDERS[cfg.provider].endpointHost + '/*';
    const granted = await chrome.permissions.request({ origins: [host] }).catch(() => false);
    if (!granted) {
      status.attempted = false;
      status.error = 'Permissão de rede para ' + host + ' não concedida.';
      return status;
    }
    try {
      setBusy(true, 'Classificando comentários com IA (0%)…');
      const map = await AI.classifyComments(cfg, state.raw.post.content.fullText, state.analysis.comments,
        (done, total) => notice('busy', `Classificando comentários com IA (${Math.round(done / total * 100)}%)…`));
      for (const c of state.analysis.comments) {
        const r = map.get(c.id);
        if (r) {
          c.sentiment = r.sentiment;
          if (r.clusters && r.clusters.length) { c.clusters = r.clusters; c.clustersSource = 'ai'; }
        }
      }
      // Reagrega com as classificações da IA
      const agg = A.aggregate(state.raw, state.analysis.comments);
      state.analysis.aggregates = agg;
      state.analysis.indices = A.indices(state.raw, agg, state.analysis.scores);
      state.analysis.motivations = A.motivations(state.raw, agg);
      state.analysis.report = A.buildReport(state.raw, agg, state.analysis.scores, state.analysis.hook, state.analysis.indices, state.analysis.motivations);
      state.analysis.report.summary.theme = state.analysis.themes.main;

      setBusy(true, 'Gerando interpretação narrativa…');
      state.analysis.aiNarrative = await AI.narrativeReport(cfg, state.raw, agg);
      state.analysis.mode = 'local+ia';
      await saveSettings();
      status.ok = true;
    } catch (e) {
      status.error = String(e && e.message || e);
    }
    return status;
  }

  // -------------------------------------------------------------- renderização

  function metricBlock(label, m) {
    const val = m.available ? (m.normalized != null ? m.normalized.toLocaleString('pt-BR') : m.raw) : '—';
    const raw = m.available && m.precision === 'abbreviated' ? `<span class="raw">exibido: ${esc(m.raw)}</span>` : '';
    return `<div class="metric"><b>${esc(String(val))}</b><span>${esc(label)}</span>${raw}</div>`;
  }

  function render() {
    if (!state) { $('results').hidden = true; $('empty-state').hidden = false; return; }
    $('empty-state').hidden = true;
    $('results').hidden = false;

    const { raw, analysis: a } = state;

    // Visão geral
    $('ov-author').textContent = raw.post.author.name || 'Autor não identificado';
    $('ov-headline').textContent = raw.post.author.headline || '';
    $('ov-type').textContent = raw.post.type + (a.language !== 'unknown' ? ' · ' + a.language : '');
    $('ov-metrics').innerHTML =
      metricBlock('reações', raw.metrics.reactions) +
      metricBlock('comentários', raw.metrics.comments) +
      metricBlock('compart.', raw.metrics.reposts) +
      metricBlock('visualiz.', raw.metrics.views);

    const cov = raw.coverage;
    const bar = $('cov-bar');
    if (cov.ratio != null) {
      bar.classList.remove('unknown');
      bar.style.width = (cov.ratio * 100) + '%';
      $('cov-label').textContent = `${cov.commentsLoaded}/${cov.commentsDeclared} (${(cov.ratio * 100).toFixed(1)}%)`;
    } else {
      bar.classList.add('unknown');
      $('cov-label').textContent = `${cov.commentsLoaded} coletados / total desconhecido`;
    }
    $('cov-note').textContent = cov.complete
      ? 'Amostra aparentemente completa para os dados visíveis.'
      : 'Amostra parcial. As análises valem apenas para os comentários coletados.';

    renderPost(raw, a);
    renderEngagement(raw, a);
    renderSentiment(raw, a);
    renderComments(raw, a);
    renderMotivations(raw, a);
    renderReport(raw, a);
    $('tab-raw').innerHTML = `<div class="rawjson">${esc(JSON.stringify(EXP.fullJson(state), null, 2))}</div>`;
  }

  function kv(pairs) {
    return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? '—' : v}</dd>`).join('')}</dl>`;
  }

  function renderPost(raw, a) {
    const c = raw.post.content;
    const au = raw.post.author;
    let html = `<h3>Identificação</h3><div class="card">` + kv([
      ['URL', `<a href="${esc(raw.meta.url)}" target="_blank" rel="noopener">${esc(raw.meta.url)}</a>`],
      ['ID', esc(raw.meta.postId || '')],
      ['Coletado em', esc(raw.meta.collectedAt)],
      ['Tipo', esc(raw.post.type) + (raw.post.mediaDetected.length ? ` (mídia: ${esc(raw.post.mediaDetected.join(', '))})` : '')],
      ['Idioma', esc(a.language)]
    ]) + `</div>`;

    html += `<h3>Autor</h3><div class="card">` + kv([
      ['Nome', esc(au.name || '')],
      ['Perfil', au.profileUrl ? `<a href="${esc(au.profileUrl)}" target="_blank" rel="noopener">${esc(au.profileUrl)}</a>` : null],
      ['Headline', esc(au.headline || '')],
      ['Seguidores', au.followers.available ? esc(au.followers.raw) + ` (~${au.followers.normalized.toLocaleString('pt-BR')})` : 'não visível'],
      ['Conexão', esc(au.connectionDegree || 'não visível')],
      ['Verificado', au.verified ? 'sim' : 'não indicado']
    ]) + `</div>`;

    html += `<h3>Texto (${c.stats.chars} caracteres, ${c.stats.words} palavras, ${c.stats.paragraphs} parágrafos)</h3>`;
    if (c.truncatedInDom) html += `<p class="fineprint">Texto truncado no DOM. Clique em "ver mais" na página e atualize a coleta.</p>`;
    html += `<div class="posttext">${esc(c.fullText || '(sem texto)')}</div>`;

    html += `<h3>Elementos</h3><div class="card">` + kv([
      ['Hashtags', esc(c.hashtags.join(' ') || 'nenhuma')],
      ['Menções', esc(c.mentions.join(' ') || 'nenhuma')],
      ['Links', c.links.length ? c.links.map(l => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('<br>') : 'nenhum'],
      ['Emojis', esc(c.emojis.join(' ') || 'nenhum')],
      ['Alt de imagens', esc(c.mediaAltTexts.join(' | ') || 'não disponível')],
      ['CTA', c.cta.present ? `sim (${esc(c.cta.type)})` : 'não identificado']
    ]) + `</div>`;

    if (raw.post.repost) {
      const rp = raw.post.repost;
      html += `<h3>Publicação original (repost)</h3><div class="card">` + kv([
        ['Autor original', esc(rp.originalAuthor.name || '')],
        ['Conteúdo original', esc((rp.originalText || '').slice(0, 600))],
        ['Nota', esc(rp.note)]
      ]) + `</div>`;
    }

    html += `<h3>Engenharia do gancho</h3><div class="card">
      <p style="font-style:italic">"${esc(a.hook.text)}"</p>` + kv([
      ['Categorias', esc(a.hook.categories.join(', '))],
      ['Por que interrompe', esc(a.hook.whyItStopsScroll)],
      ['Expectativa criada', esc(a.hook.expectationCreated)],
      ['Entrega', esc(a.hook.expectationDelivered.note) + ' <i>(hipótese)</i>'],
      ['Lacuna de curiosidade', (a.hook.curiosityGap.value ? 'provável' : 'não evidente') + ' <i>(hipótese)</i>'],
      ['Depende da reputação', (a.hook.dependsOnAuthorReputation.value ? 'há sinais' : 'sem sinais fortes') + ' <i>(hipótese)</i>']
    ]) + `</div>`;

    $('tab-post').innerHTML = html;
  }

  function renderEngagement(raw, a) {
    let html = `<h3>Avaliação do conteúdo (heurística 0-10)</h3><div class="card">`;
    for (const [name, s] of Object.entries(a.scores)) {
      html += `<div class="scorebar" title="${esc(s.rationale)}"><span>${esc(name)}</span><div class="track"><div class="fill" style="width:${s.score * 10}%"></div></div><b>${s.score}</b></div>`;
    }
    html += `<p class="fineprint">Passe o mouse sobre cada critério para ver a justificativa. Notas heurísticas de estrutura, não medidas de qualidade real.</p></div>`;

    html += `<h3>Qualidade do engajamento: ${esc(a.aggregates.engagementClass)}</h3><div class="card">`;
    const q = a.aggregates.quality;
    for (const [label, item] of [['Taxa de genéricos', q.genericRate], ['Taxa de conversação', q.conversationRate], ['Taxa de contribuição', q.contributionRate], ['Taxa de intenção', q.intentRate]]) {
      html += `<div class="scorebar" title="${esc(item.formula)}"><span>${esc(label)}</span><div class="track"><div class="fill" style="width:${item.value}%"></div></div><b>${item.value}%</b></div>`;
    }
    html += kv([['Profundidade média', `${esc(q.avgDepth.value)} (${q.avgDepth.avgWordsPerComment} palavras/comentário)`], ['Fórmula', esc(q.avgDepth.formula)]]) + `</div>`;

    html += `<h3>Índices analíticos (0-100)</h3><div class="card">`;
    for (const [name, idx] of Object.entries(a.indices)) {
      html += `<div class="scorebar" title="${esc(idx.methodology)}"><span>${esc(name)}</span><div class="track"><div class="fill" style="width:${idx.value}%"></div></div><b>${idx.value}</b></div>`;
    }
    html += `<p class="fineprint">Indicadores criados por esta extensão; não são métricas oficiais do LinkedIn.</p></div>`;

    html += `<h3>Tipos de reação visíveis</h3><div class="card"><p>${Object.keys(raw.metrics.byType).length ? esc(Object.keys(raw.metrics.byType).join(', ')) + ' (contagens individuais não exibidas pelo LinkedIn nesta visão)' : 'Distribuição por tipo não disponível na página.'}</p></div>`;

    $('tab-engagement').innerHTML = html;
  }

  function renderSentiment(raw, a) {
    const dist = a.aggregates.sentimentDist;
    const total = a.aggregates.totalAnalyzed || 1;
    const order = ['positivo', 'misto', 'neutro', 'indeterminado', 'negativo'];
    let bar = '<div class="dist">';
    let legend = '<div class="legend">';
    for (const k of order) {
      const v = dist[k] || 0;
      if (!v) continue;
      bar += `<span class="d-${k}" style="width:${(v / total) * 100}%" title="${k}: ${v}"></span>`;
      legend += `<span><i class="d-${k}"></i>${k}: ${v} (${U.pct(v, total)}%)</span>`;
    }
    bar += '</div>'; legend += '</div>';

    let html = `<h3>Distribuição de sentimento (${total} comentários)</h3><div class="card">${bar}${legend}
      <p class="fineprint">Fonte: ${a.mode === 'local+ia' ? 'classificação por IA' : 'léxico local (precisão limitada; ironia e contexto podem escapar)'}.</p></div>`;

    const em = Object.entries(a.aggregates.emotionDist).sort((x, y) => y[1] - x[1]);
    html += `<h3>Emoções predominantes</h3><div class="card">`;
    html += em.length ? em.map(([k, v]) => `<div class="scorebar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / total) * 100}%"></div></div><b>${v}</b></div>`).join('') : '<p>Nenhuma emoção identificável.</p>';
    html += `</div>`;

    html += `<h3>Clusters comportamentais</h3><div class="card">`;
    for (const c of a.aggregates.clusters) {
      html += `<div class="scorebar"><span>${esc(c.name)}</span><div class="track"><div class="fill" style="width:${c.pct}%"></div></div><b>${c.pct}%</b></div>`;
      if (c.examples.length) html += `<p class="fineprint" style="margin:0 0 6px">ex.: "${esc(c.examples[0].text.slice(0, 140))}" (${esc(c.examples[0].author || 'anônimo')})</p>`;
    }
    html += `<p class="fineprint">Um comentário pode pertencer a mais de uma categoria.</p></div>`;

    if (a.aggregates.topDiscussion.length) {
      html += `<h3>Comentários que mais geraram discussão</h3><div class="card">` +
        a.aggregates.topDiscussion.map(t => `<div class="comment"><div class="comment-head"><b>${esc(t.author || 'anônimo')}</b><span>${t.replies.available ? t.replies.normalized + ' respostas' : ''}</span></div><div class="comment-text">${esc(t.text)}</div></div>`).join('') + `</div>`;
    }

    $('tab-sentiment').innerHTML = html;
  }

  function renderComments(raw, a) {
    const list = a.comments;
    if (!list.length) { $('tab-comments').innerHTML = '<div class="card"><p>Nenhum comentário carregado no DOM no momento da coleta.</p></div>'; return; }
    let html = `<div class="card">`;
    for (const c of list) {
      const sTag = `<span class="tag s-${esc(c.sentiment.label)}">${esc(c.sentiment.label)}${c.sentiment.emotion ? ' · ' + esc(c.sentiment.emotion) : ''} (${c.sentiment.confidence})</span>`;
      const srcTag = `<span class="tag ${c.sentiment.source === 'ai' ? 'src-ai' : ''}">${c.sentiment.source === 'ai' ? 'IA' : 'regras'}</span>`;
      const flagTags = [c.flags.byPostAuthor ? '<span class="tag">autor do post</span>' : '', c.flags.highlighted ? '<span class="tag">destaque</span>' : '', c.flags.genericOnly ? '<span class="tag">genérico</span>' : ''].join('');
      html += `<div class="comment ${c.level > 0 ? 'reply' : ''}" title="${esc(c.sentiment.rationale)}">
        <div class="comment-head"><b>${esc(c.author.name || 'anônimo')}</b><span>${esc(c.timeLabel || '')}${c.reactions.available ? ' · ' + esc(String(c.reactions.raw)) + ' reações' : ''}</span></div>
        ${c.author.headline ? `<div class="fineprint">${esc(c.author.headline)}</div>` : ''}
        <div class="comment-text">${esc(c.text || '')}</div>
        <div class="tags">${sTag}${srcTag}${(c.clusters || []).map(cl => `<span class="tag">${esc(cl)}</span>`).join('')}${flagTags}</div>
      </div>`;
    }
    html += `</div>`;
    $('tab-comments').innerHTML = html;
  }

  function renderMotivations(raw, a) {
    const m = a.motivations;
    const block = (title, items) => `<h3>${esc(title)}</h3><div class="card">` +
      items.map(i => `<div class="hyp"><b>${esc(i.hypothesis)}</b> <span class="tag">hipótese · ${esc(i.strength)}</span><div class="ev">${esc(i.evidence)}</div></div>`).join('') + `</div>`;

    let html = `<div class="card"><p class="fineprint">${esc(m.disclaimer)}</p></div>`;
    html += block('Por que reagiram', m.reactions);
    html += block('Por que comentaram', m.comments);
    html += block('Por que compartilharam', m.shares);
    if (a.aiNarrative) {
      html += `<h3>Interpretação da IA</h3><div class="card">
        <div class="obs">${esc(a.aiNarrative.whyLikes || '')}</div>
        <div class="obs">${esc(a.aiNarrative.whyComments || '')}</div>
        <div class="obs">${esc(a.aiNarrative.whyShares || '')}</div></div>`;
    }
    $('tab-motivations').innerHTML = html;
  }

  function renderReport(raw, a) {
    const r = a.report;
    let html = `<h3>Resumo executivo</h3><div class="card">` + kv([
      ['Tema', esc(r.summary.theme || '')],
      ['Motivo provável', esc(r.summary.mainDriver.value) + ' <i>(hipótese)</i>'],
      ['Sentimento', esc(r.summary.dominantSentiment)],
      ['Qualidade', esc(r.summary.engagementQuality)],
      ['Gatilho de compart.', esc(r.summary.mainShareTrigger || '') + ' <i>(hipótese)</i>'],
      ['Limitação principal', esc(r.summary.mainLimitation)]
    ]) + `</div>`;

    html += `<h3>Diagnóstico</h3><div class="card">`;
    for (const [q, ans] of Object.entries(r.diagnosis)) {
      html += `<p><b>${esc(q)}</b><br>${esc(ans)}</p>`;
    }
    html += `</div>`;

    if (a.aiNarrative && a.aiNarrative.narrative) {
      html += `<h3>Narrativa (IA)</h3><div class="card">${esc(a.aiNarrative.narrative).replace(/\n/g, '<br>')}</div>`;
    }

    const rec = r.recommendations;
    html += `<h3>Recomendações</h3><div class="card">
      <p><b>Replicáveis:</b></p>${rec.replicable.map(x => `<div class="obs">${esc(x)}</div>`).join('')}
      <p><b>Não copiar literalmente:</b></p>${rec.doNotCopyLiterally.map(x => `<div class="hyp">${esc(x)}</div>`).join('')}
      <p><b>Melhorias:</b></p>${rec.improvements.map(x => `<div class="hyp">${esc(x)}</div>`).join('')}
      <p><b>Estrutura sugerida:</b> ${esc(rec.suggestedStructure)}</p>
      <p><b>Riscos de interpretação:</b></p>${rec.interpretationRisks.map(x => `<div class="hyp">${esc(x)}</div>`).join('')}
    </div>`;

    $('tab-report').innerHTML = html;
  }

  // -------------------------------------------------------------------- wiring

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
  }));

  $('btn-analyze').addEventListener('click', () => analyze(false));
  $('btn-refresh').addEventListener('click', () => analyze(true));
  $('btn-clear').addEventListener('click', async () => {
    state = null;
    await send({ type: 'CLEAR_STATE' });
    notice(null);
    render();
    checkPage();
  });

  $('exp-json').addEventListener('click', () => state && EXP.downloadJson(state));
  $('exp-csv-comments').addEventListener('click', () => state && EXP.downloadCommentsCsv(state));
  $('exp-csv-metrics').addEventListener('click', () => state && EXP.downloadMetricsCsv(state));
  $('exp-md').addEventListener('click', () => state && EXP.downloadMarkdown(state));
  $('exp-html').addEventListener('click', () => state && EXP.downloadHtml(state));

  ['ai-enabled', 'ai-provider', 'ai-model', 'ai-persist'].forEach(id => $(id).addEventListener('change', () => {
    $('ai-model').placeholder = AI.PROVIDERS[$('ai-provider').value].defaultModel;
    saveSettings();
  }));
  $('ai-key').addEventListener('change', saveSettings);

  chrome.tabs.onActivated.addListener(checkPage);
  chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete' || info.url) checkPage(); });

  // ---------------------------------------------------------------------- init

  (async function init() {
    await loadSettings();
    const res = await send({ type: 'LOAD_STATE' });
    if (res && res.state) { state = res.state; render(); }
    await checkPage();
  })();
})();
