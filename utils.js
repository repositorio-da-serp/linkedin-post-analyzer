/**
 * utils.js
 * Utilitários puros, sem dependência de DOM ou de APIs do Chrome.
 * Carregado tanto na página (injeção) quanto no painel e nos testes Node.
 */
(function () {
  if (globalThis.__LPA_UTILS) return;

  const U = {};

  /** Remove espaços invisíveis e normaliza whitespace, preservando quebras de parágrafo. */
  U.cleanText = function (s) {
    if (s == null) return '';
    return String(s)
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  /** Versão normalizada para processamento: minúsculas, sem acentos, espaços simples. */
  U.normalizeForNlp = function (s) {
    return U.cleanText(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Converte um valor exibido pelo LinkedIn em número.
   * Cobre pt-BR ("1,2 mil", "12 mil", "1.234", "3 mi") e en ("1.2K", "1,234", "2M").
   * Retorna { raw, normalized, precision, available }.
   * precision: "exact" | "abbreviated" | "unavailable".
   */
  U.parseCount = function (raw) {
    const out = { raw: raw == null ? null : String(raw).trim(), normalized: null, precision: 'unavailable', available: false };
    if (out.raw == null || out.raw === '') return out;
    const s = out.raw.toLowerCase().replace(/\u00a0/g, ' ').trim();
    const m = s.match(/([\d][\d.,\s]*)\s*(mil(?:h[aã]o|h[oõ]es)?|mi\b|k\b|m\b|b\b|thousand|million|billion)?/i);
    if (!m || !m[1]) return out;
    let num = m[1].replace(/\s/g, '');
    const suffix = (m[2] || '').toLowerCase();

    let value = null;
    if (/^\d{1,3}([.,]\d{3})+$/.test(num)) {
      // Separador de milhar: 1.234 ou 1,234
      value = parseInt(num.replace(/[.,]/g, ''), 10);
    } else if (/^\d+[.,]\d{1,2}$/.test(num)) {
      // Decimal: 1,2 ou 1.2
      value = parseFloat(num.replace(',', '.'));
    } else if (/^\d+$/.test(num)) {
      value = parseInt(num, 10);
    } else {
      return out;
    }

    let mult = 1;
    if (suffix === 'mil' || suffix === 'k' || suffix === 'thousand') mult = 1e3;
    else if (suffix === 'mi' || suffix === 'm' || suffix === 'million' || suffix.startsWith('milh')) mult = 1e6;
    else if (suffix === 'b' || suffix === 'billion') mult = 1e9;

    out.normalized = Math.round(value * mult);
    out.precision = mult > 1 ? 'abbreviated' : 'exact';
    out.available = true;
    return out;
  };

  /** Extrai o primeiro número (com sufixo) de um texto livre, ex.: "347 comentários". */
  U.parseCountFromText = function (text) {
    if (!text) return U.parseCount(null);
    const m = String(text).match(/[\d][\d.,\s]*\s*(?:mil|mi|k|m|b|thousand|million)?/i);
    return U.parseCount(m ? m[0] : null);
  };

  U.countWords = function (s) {
    const t = U.cleanText(s);
    return t ? t.split(/\s+/).length : 0;
  };

  U.countParagraphs = function (s) {
    const t = U.cleanText(s);
    return t ? t.split(/\n\s*\n|\n/).filter(p => p.trim().length > 0).length : 0;
  };

  U.extractHashtags = function (s) {
    return (String(s || '').match(/#[\p{L}\p{N}_]+/gu) || []).map(h => h.toLowerCase());
  };

  U.extractMentions = function (s) {
    return (String(s || '').match(/@[\p{L}\p{N}._-]+/gu) || []);
  };

  U.extractUrls = function (s) {
    // Charset restrito ao válido em URL: não engole emojis/pontuação colada
    return (String(s || '').match(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/g) || [])
      .map(u => u.replace(/[.,;:!?)\]]+$/, ''));
  };

  /**
   * Remove o boilerplate de cabeçalho que o LinkedIn (DOM novo) concatena antes do
   * texto do post quando a extração cai no fallback estrutural:
   * "Publicação no feed NOME • Seguindo HEADLINE Agende uma reunião 4 d • TEXTO..."
   * Retorna { stripped, author: {name, headline}|null, timeLabel, text }.
   */
  U.stripFeedBoilerplate = function (raw) {
    const t = U.cleanText(raw);
    const out = { stripped: false, author: null, timeLabel: null, text: t };
    const flat = t.replace(/\n/g, ' ');
    const marker = /^(publicação no feed|feed post)/i.test(flat.trim());
    const timeRe = /(\d+\s?(?:min|h|d|sem|m[êe]s(?:es)?|a|w|mo|y))\s*[•·]?\s*(?:editado\s*[•·]?\s*|edited\s*[•·]?\s*)?/i;
    const m = flat.slice(0, 500).match(timeRe);
    if (!m) return out;
    const prefix = flat.slice(0, m.index);
    // Só remove se houver evidência de cabeçalho (marcador ou separadores típicos)
    if (!marker && !(m.index < 300 && /[•·]/.test(prefix) && /(seguindo|following|agende uma reunião|ver perfil|visit profile)/i.test(prefix))) return out;
    const body = flat.slice(m.index + m[0].length).trim();
    if (body.length < 20) return out;

    let head = prefix.replace(/^(publicação no feed|feed post)\s*/i, '').trim();
    head = head.replace(/(agende uma reunião|ver perfil|visit profile).*/i, '').trim();
    const parts = head.split(/[•·]/).map(s => s.trim()).filter(Boolean);
    let name = parts[0] || null;
    let headline = parts.slice(1).join(' • ').replace(/^(seguindo|following)\s*/i, '').trim() || null;
    if (headline === '') headline = null;

    out.stripped = true;
    out.author = name ? { name, headline } : null;
    out.timeLabel = m[1];
    out.text = body;
    return out;
  };

  /**
   * Extrai uma contagem ADJACENTE a uma palavra-chave dentro de um rótulo curto.
   * Aceita "85 compartilhamentos" e "comentários: 11". Retorna parseCount ou null.
   */
  U.adjacentCount = function (text, kwSource) {
    if (!text) return null;
    const num = "([\\d][\\d.,\\s]*(?:mil|k|m|mi)?)";
    const before = new RegExp(num + '\\s*(?:' + kwSource + ')', 'i');
    const after = new RegExp('(?:' + kwSource + ')[^0-9]{0,12}' + num, 'i');
    const m = text.match(before) || text.match(after);
    if (!m) return null;
    const parsed = U.parseCount(m[1]);
    return parsed.available ? parsed : null;
  };

  const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

  U.extractEmojis = function (s) {
    return (String(s || '').match(EMOJI_RE) || []);
  };

  U.isEmojiOnly = function (s) {
    const t = U.cleanText(s).replace(EMOJI_RE, '').replace(/[\s.!?,]/g, '');
    return U.cleanText(s).length > 0 && t.length === 0 && U.extractEmojis(s).length > 0;
  };

  /** Detecção simples de idioma pt/en por stopwords. Retorna "pt", "en" ou "unknown". */
  U.detectLanguage = function (s) {
    const t = ' ' + U.normalizeForNlp(s) + ' ';
    const ptHits = (t.match(/ (que|nao|para|com|uma|isso|mais|voce|como|muito|obrigad\w|por|dos|das|sao|esta|foi) /g) || []).length;
    const enHits = (t.match(/ (the|and|that|this|with|for|you|your|are|was|have|not|but|from|they) /g) || []).length;
    if (ptHits === 0 && enHits === 0) return 'unknown';
    if (ptHits >= enHits) return 'pt';
    return 'en';
  };

  /** Hash determinístico curto (djb2) para gerar IDs estáveis de comentários. */
  U.hash = function (s) {
    let h = 5381;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };

  /**
   * Detecta um prefixo de 2 a 5 palavras que se repete adiante no texto.
   * Útil para extrair o nome em cabeçalhos achatados do LinkedIn, em que o
   * nome aparece duas vezes: "Daniel Bender Usuário verificado ... Daniel Bender • 2º ...".
   */
  U.duplicatedPrefix = function (s) {
    const head = U.cleanText(s);
    const words = head.split(/\s+/);
    for (let n = Math.min(5, words.length - 1); n >= 2; n--) {
      const p = words.slice(0, n).join(' ');
      if (p.length >= 5 && head.indexOf(p, p.length) !== -1) return p;
    }
    return null;
  };

  /**
   * Extrai contagem de reações de frases de prova social do LinkedIn:
   * "Fulano e outras 89 pessoas" (total = 89 + 1, estimated) ou
   * "90 pessoas reagiram" (exact). Retorna parseCount-like ou null.
   */
  U.reactionsPhraseCount = function (text) {
    const t = String(text || '');
    const NUM = "([\\d][\\d.,]*\\s*(?:mil|k|m|mi)?)";
    // "Fulano e mais/outras N pessoas" ou "and N others": total = N + a pessoa nomeada
    let m = t.match(new RegExp('(?:e|and)\\s+(?:mais|outras?|others?)\\s+' + NUM + '\\s*(?:pessoas|people)?', 'i'))
      || t.match(new RegExp('(?:e|and)\\s+' + NUM + '\\s+(?:outras?|others?)', 'i'));
    if (m) {
      const p = U.parseCount(m[1]);
      if (p.available) {
        p.normalized += 1; // a pessoa nomeada antes de "e mais/outras N"
        p.precision = p.precision === 'exact' ? 'estimated' : p.precision;
        p.raw = U.cleanText(m[0]);
        return p;
      }
    }
    m = t.match(new RegExp(NUM + '\\s*(?:pessoas|people)\\s*(?:reagiram|reacted|curtiram|liked)', 'i'));
    if (m) {
      const p = U.parseCount(m[1]);
      if (p.available) { p.raw = U.cleanText(m[0]); return p; }
    }
    return null;
  };

  /** Normaliza para comparação com slugs de URL: "Diego Ivo" -> "diegoivo". */
  U.slugify = function (s) {
    return U.cleanText(s).toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  };

  /**
   * Deriva um nome legível do slug de um link de perfil:
   * "/in/mauricio-amaro/" -> "Mauricio Amaro"; "/in/gabriel-pizani-1a2b3c" -> "Gabriel Pizani".
   * Retorna null para slugs de token único (ex.: "/in/fabiosp"), que não são
   * decomponíveis com segurança.
   */
  U.nameFromProfileSlug = function (href) {
    const m = String(href || '').match(/\/(?:in|company)\/([^/?#]+)/i);
    if (!m) return null;
    let parts = decodeURIComponent(m[1]).split('-').filter(Boolean);
    while (parts.length > 1 && /\d/.test(parts[parts.length - 1])) parts.pop();
    if (parts.length < 2) return null;
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  };

  U.pct = function (part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 1000) / 10;
  };

  U.clamp = function (v, min, max) {
    return Math.max(min, Math.min(max, v));
  };

  U.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  U.escapeCsv = function (s) {
    const v = String(s == null ? '' : s);
    return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };

  globalThis.__LPA_UTILS = U;

  // Compatibilidade com testes Node (CommonJS)
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})();
