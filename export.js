/**
 * export.js
 * Gera e baixa os artefatos de exportação a partir do estado {raw, analysis, meta}.
 * Todos os arquivos são gerados localmente (Blob); nada é enviado a servidores.
 */
(function () {
  if (globalThis.__LPA_EXPORT) return;
  const U = globalThis.__LPA_UTILS;
  const E = {};
  const VERSION = '1.7.1';

  function download(filename, mime, content) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function baseName(state) {
    const id = (state.raw.meta.postId || 'post').toString().slice(-10);
    return `lpa_${id}_${state.raw.meta.collectedAt.slice(0, 10)}`;
  }

  // ---------------------------------------------------------------------- JSON

  E.fullJson = function (state) {
    return {
      exportVersion: VERSION,
      extensionVersion: VERSION,
      collectedAt: state.raw.meta.collectedAt,
      coverage: state.raw.coverage,
      mode: state.analysis.mode,
      aiStatus: state.aiStatus || null,
      raw: state.raw,                    // dados brutos como extraídos
      analysis: state.analysis,          // normalizados + análises + índices + hipóteses (com confidence)
      diagnostics: state.raw.diagnostics
    };
  };

  E.downloadJson = function (state) {
    download(baseName(state) + '.json', 'application/json', JSON.stringify(E.fullJson(state), null, 2));
  };

  // ----------------------------------------------------------------------- CSV

  E.commentsCsv = function (state) {
    const header = ['id', 'parent_id', 'nivel', 'autor', 'headline', 'perfil_url', 'texto', 'tempo', 'reacoes_raw', 'reacoes_num', 'respostas', 'autor_do_post', 'destaque', 'generico', 'so_emoji', 'so_marcacao', 'sentimento', 'emocao', 'intensidade', 'confianca', 'clusters', 'fonte_classificacao'];
    const rows = state.analysis.comments.map(c => [
      c.id, c.parentId || '', c.level, c.author.name || '', c.author.headline || '', c.author.profileUrl || '',
      c.text || '', c.timeLabel || '', c.reactions.raw || '', c.reactions.normalized ?? '', c.repliesCount.normalized ?? '',
      c.flags.byPostAuthor, c.flags.highlighted, c.flags.genericOnly, c.flags.emojiOnly, c.flags.mentionOnly,
      c.sentiment.label, c.sentiment.emotion || '', c.sentiment.intensity, c.sentiment.confidence,
      (c.clusters || []).join('|'), c.sentiment.source
    ]);
    return [header, ...rows].map(r => r.map(U.escapeCsv).join(',')).join('\r\n');
  };

  E.metricsCsv = function (state) {
    const m = state.raw.metrics;
    const rows = [['metrica', 'valor_exibido', 'valor_normalizado', 'precisao', 'disponivel']];
    for (const [k, label] of [['reactions', 'reacoes'], ['comments', 'comentarios'], ['reposts', 'compartilhamentos'], ['views', 'visualizacoes']]) {
      rows.push([label, m[k].raw ?? '', m[k].normalized ?? '', m[k].precision, m[k].available]);
    }
    for (const [type, v] of Object.entries(m.byType || {})) {
      rows.push(['reacao_tipo_' + type, 'presente (contagem não exibida pelo LinkedIn)', '', 'unavailable', true]);
    }
    const cov = state.raw.coverage;
    rows.push(['comentarios_coletados', cov.commentsLoaded, cov.commentsLoaded, 'exact', true]);
    rows.push(['cobertura_amostra', cov.ratio != null ? (cov.ratio * 100).toFixed(1) + '%' : 'desconhecida', cov.ratio ?? '', cov.ratio != null ? 'estimated' : 'unavailable', cov.ratio != null]);
    for (const [name, idx] of Object.entries(state.analysis.indices)) {
      rows.push(['indice_' + name.replace(/\s+/g, '_'), idx.value, idx.value, 'heuristic', true]);
    }
    return rows.map(r => r.map(U.escapeCsv).join(',')).join('\r\n');
  };

  E.downloadCommentsCsv = function (state) { download(baseName(state) + '_comentarios.csv', 'text/csv', '\ufeff' + E.commentsCsv(state)); };
  E.downloadMetricsCsv = function (state) { download(baseName(state) + '_metricas.csv', 'text/csv', '\ufeff' + E.metricsCsv(state)); };

  // ------------------------------------------------------------------ Markdown

  E.markdown = function (state) {
    const { raw, analysis: a } = state;
    const r = a.report;
    const L = [];
    L.push(`# Análise de publicação do LinkedIn`);
    L.push(`\n> Gerado por LinkedIn Post Analyzer v${VERSION} em ${raw.meta.collectedAt}. Modo: ${a.mode}.`);
    L.push(`> ${r.coverageNote}`);
    L.push(`\n**URL:** ${raw.meta.url}  \n**Autor:** ${raw.post.author.name || 'n/d'} (${raw.post.author.headline || 'headline n/d'})  \n**Tipo:** ${raw.post.type} | **Idioma:** ${a.language}`);

    L.push(`\n## Resumo executivo`);
    L.push(`- **Tema:** ${r.summary.theme || 'n/d'}`);
    L.push(`- **Principal motivo provável do desempenho:** ${r.summary.mainDriver.value} _(hipótese)_`);
    L.push(`- **Sentimento predominante:** ${r.summary.dominantSentiment}`);
    L.push(`- **Qualidade do engajamento:** ${r.summary.engagementQuality}`);
    L.push(`- **Principal gatilho de compartilhamento:** ${r.summary.mainShareTrigger || 'n/d'} _(hipótese)_`);
    L.push(`- **Principal limitação:** ${r.summary.mainLimitation}`);

    L.push(`\n## Métricas`);
    const m = raw.metrics;
    L.push(`| Métrica | Exibido | Normalizado | Precisão |\n|---|---|---|---|`);
    for (const [k, label] of [['reactions', 'Reações'], ['comments', 'Comentários'], ['reposts', 'Compartilhamentos'], ['views', 'Visualizações']]) {
      L.push(`| ${label} | ${m[k].raw ?? 'indisponível'} | ${m[k].normalized ?? '-'} | ${m[k].precision} |`);
    }

    L.push(`\n## Avaliação do conteúdo (heurística, 0-10)`);
    for (const [name, s] of Object.entries(a.scores)) L.push(`- **${name}: ${s.score}** — ${s.rationale}`);

    L.push(`\n## Gancho`);
    L.push(`> ${a.hook.text.replace(/\n/g, ' ')}`);
    L.push(`\n- Categorias: ${a.hook.categories.join(', ')}`);
    L.push(`- ${a.hook.whyItStopsScroll}`);
    L.push(`- Expectativa criada: ${a.hook.expectationCreated}`);
    L.push(`- Entrega da expectativa: ${a.hook.expectationDelivered.note} _(hipótese)_`);

    L.push(`\n## Sentimentos e clusters`);
    L.push(`Distribuição: ${Object.entries(a.aggregates.sentimentDist).map(([k, v]) => `${k}: ${v}`).join(' | ') || 'sem comentários'}`);
    L.push(`\n| Cluster | Qtde | % | Intensidade média |\n|---|---|---|---|`);
    for (const c of a.aggregates.clusters) L.push(`| ${c.name} | ${c.count} | ${c.pct}% | ${c.avgIntensity} |`);

    L.push(`\n## Qualidade do engajamento (${a.aggregates.engagementClass})`);
    const q = a.aggregates.quality;
    L.push(`- Taxa de genéricos: **${q.genericRate.value}%** (${q.genericRate.formula})`);
    L.push(`- Taxa de conversação: **${q.conversationRate.value}%** (${q.conversationRate.formula})`);
    L.push(`- Taxa de contribuição: **${q.contributionRate.value}%** (${q.contributionRate.formula})`);
    L.push(`- Taxa de intenção: **${q.intentRate.value}%** (${q.intentRate.formula})`);
    L.push(`- Profundidade média: **${q.avgDepth.value}** (${q.avgDepth.formula})`);

    L.push(`\n## Índices analíticos (0-100, criados pela extensão)`);
    for (const [name, idx] of Object.entries(a.indices)) L.push(`- **${name}: ${idx.value}** — ${idx.methodology}`);

    L.push(`\n## Diagnóstico`);
    for (const [qst, ans] of Object.entries(r.diagnosis)) L.push(`\n**${qst}**\n${ans}`);

    if (a.aiNarrative) {
      L.push(`\n## Interpretação (modo IA)`);
      L.push(a.aiNarrative.narrative || '');
    }

    L.push(`\n## Recomendações`);
    L.push(`**Replicáveis:**`); r.recommendations.replicable.forEach(x => L.push(`- ${x}`));
    L.push(`\n**Não copiar literalmente:**`); r.recommendations.doNotCopyLiterally.forEach(x => L.push(`- ${x}`));
    L.push(`\n**Melhorias:**`); r.recommendations.improvements.forEach(x => L.push(`- ${x}`));
    L.push(`\n**Estrutura sugerida:** ${r.recommendations.suggestedStructure}`);
    L.push(`\n**Riscos de interpretação:**`); r.recommendations.interpretationRisks.forEach(x => L.push(`- ${x}`));

    return L.join('\n');
  };

  E.downloadMarkdown = function (state) { download(baseName(state) + '_relatorio.md', 'text/markdown', E.markdown(state)); };

  // ---------------------------------------------------------------------- HTML

  E.html = function (state) {
    const md = E.markdown(state);
    // Conversão mínima e segura de Markdown para HTML (sem lib externa)
    const esc = U.escapeHtml;
    const body = md.split('\n').map(line => {
      if (/^# /.test(line)) return `<h1>${esc(line.slice(2))}</h1>`;
      if (/^## /.test(line)) return `<h2>${esc(line.slice(3))}</h2>`;
      if (/^> /.test(line)) return `<blockquote>${esc(line.slice(2))}</blockquote>`;
      if (/^\|/.test(line)) {
        if (/^\|[-\s|]+\|$/.test(line)) return '';
        const cells = line.split('|').slice(1, -1).map(c => `<td>${esc(c.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }
      if (/^- /.test(line)) return `<li>${esc(line.slice(2)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>')}</li>`;
      if (line.trim() === '') return '<br>';
      return `<p>${esc(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>')}</p>`;
    }).join('\n')
      .replace(/(<tr>[\s\S]+?<\/tr>\n?)+/g, m => `<table>${m}</table>`)
      .replace(/(<li>[\s\S]+?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório LPA</title>
<style>body{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 24px;color:#1d2733;line-height:1.55}
h1,h2{font-family:'Segoe UI',system-ui,sans-serif;color:#0a2a43}h1{border-bottom:3px solid #0a66c2;padding-bottom:8px}
h2{margin-top:2em;border-bottom:1px solid #d7dfe6;padding-bottom:4px}
blockquote{border-left:4px solid #0a66c2;margin:8px 0;padding:6px 14px;background:#f2f7fb;color:#33424f}
table{border-collapse:collapse;margin:12px 0;width:100%}td{border:1px solid #d7dfe6;padding:6px 10px;font-family:system-ui,sans-serif;font-size:14px}
tr:first-child td{background:#0a2a43;color:#fff;font-weight:600}ul{margin:6px 0}li{margin:3px 0}</style>
</head><body>${body}</body></html>`;
  };

  E.downloadHtml = function (state) { download(baseName(state) + '_relatorio.html', 'text/html', E.html(state)); };

  globalThis.__LPA_EXPORT = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})();
