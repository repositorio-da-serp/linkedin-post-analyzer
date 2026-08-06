/**
 * selectors.js
 * Módulo ÚNICO de seletores do DOM do LinkedIn.
 *
 * Princípios:
 *  - Cada chave possui uma LISTA ordenada de estratégias (cascata).
 *  - Estratégias preferem atributos semânticos (data-urn, aria-*, role) a classes ofuscadas.
 *  - O extrator registra qual estratégia funcionou; falhas vão para diagnostics.selectorFailures.
 *  - Para atualizar a extensão após mudanças do LinkedIn, edite APENAS este arquivo.
 *
 * Carregado como script simples (injeção via chrome.scripting). Guardado em globalThis.
 */
(function () {
  if (globalThis.__LPA_SELECTORS) return;

  globalThis.__LPA_SELECTORS = {
    // Contêiner raiz da publicação
    // DOM novo (classes ofuscadas): componentes expõem data-view-name
    postRoot: [
      '[data-view-name="feed-full-update"]',
      'div[data-view-name*="full-update" i]',
      'div.feed-shared-update-v2[data-urn*="urn:li:activity"]',
      'div[data-urn*="urn:li:activity"]',
      'div[data-id*="urn:li:activity"]',
      'div[data-urn*="urn:li:ugcPost"]',
      'div[data-id*="urn:li:ugcPost"]',
      'div[data-urn*="urn:li:share"]',
      '.fie-impression-container',
      'div.feed-shared-update-v2',
      'main article.feed-shared-update-v2',
      'article.main-feed-activity-card',
      'main article',
      'main'
    ],

    // Texto principal da publicação
    postText: [
      '[data-view-name*="commentary" i]',
      '[data-view-name*="feed-text" i]',
      '.feed-shared-inline-show-more-text .update-components-text',
      '.update-components-text[dir]',
      '.update-components-text',
      '.feed-shared-update-v2__description'
    ],

    // Botão "ver mais" (apenas para detectar truncamento; NUNCA clicado automaticamente)
    seeMoreButton: [
      '.feed-shared-inline-show-more-text__see-more-less-toggle',
      'button[aria-label*="ver mais" i]',
      'button[aria-label*="see more" i]'
    ],

    // Autor
    authorContainer: [
      '.update-components-actor',
      '.feed-shared-actor'
    ],
    authorName: [
      '.update-components-actor__title span[aria-hidden="true"]',
      '.update-components-actor__title',
      '.feed-shared-actor__name'
    ],
    authorHeadline: [
      '.update-components-actor__description',
      '.feed-shared-actor__description'
    ],
    authorLink: [
      'a.update-components-actor__meta-link',
      'a.update-components-actor__image',
      '.update-components-actor a[href*="/in/"]',
      '.update-components-actor a[href*="/company/"]'
    ],
    authorBadges: [
      '.update-components-actor__supplementary-actor-info',
      '.update-components-actor__sub-description'
    ],

    // Mídias / tipo de publicação
    media: {
      image: ['.update-components-image', '.feed-shared-image'],
      video: ['.update-components-linkedin-video', 'video', '.feed-shared-linkedin-video'],
      document: ['.update-components-document', '.feed-shared-document', 'iframe[title*="Document" i]', 'iframe[title*="Documento" i]'],
      poll: ['.update-components-poll', '.feed-shared-poll'],
      article: ['.update-components-article', '.feed-shared-article'],
      celebration: ['.update-components-celebration']
    },

    // Repost
    repostWrapper: [
      '.feed-shared-update-v2__update-content-wrapper',
      '.update-components-mini-update-v2',
      '.feed-shared-mini-update-v2'
    ],

    // Métricas sociais
    socialCounts: [
      '.social-details-social-counts',
      '.feed-shared-social-counts'
    ],
    reactionsCount: [
      '.social-details-social-counts__reactions-count',
      'button[aria-label*="reaç" i] span',
      'button[aria-label*="reaction" i] span',
      '.social-details-social-counts__social-proof-fallback-number'
    ],
    reactionIcons: [
      '.social-details-social-counts__reactions img',
      'button[aria-label*="reaç" i] img',
      'button[aria-label*="reaction" i] img'
    ],
    commentsCount: [
      'li.social-details-social-counts__comments button',
      'button[aria-label*="comentário" i]',
      'button[aria-label*="comment" i]'
    ],
    repostsCount: [
      'button[aria-label*="compartilhamento" i]',
      'button[aria-label*="repost" i]',
      'button[aria-label*="shares" i]'
    ],
    viewsCount: [
      '.ca-entry-point__num-views',
      'span[class*="analytics"] strong',
      'li[class*="impressions"]'
    ],

    // Comentários
    commentsSection: [
      '.comments-comments-list',
      '.feed-shared-update-v2__comments-container',
      'div[class*="comments-comments-list"]'
    ],
    commentItem: [
      'article.comments-comment-entity',
      'article[class*="comments-comment"]',
      '.comments-comment-item',
      '[data-view-name*="comment-entity" i]',
      '[data-view-name*="comment-item" i]',
      'article[data-view-name*="comment" i]',
      'div[data-view-name="comment"]'
    ],
    commentAuthorName: [
      '.comments-comment-meta__description-title',
      '.comments-post-meta__name-text span[aria-hidden="true"]',
      '.comments-post-meta__name-text',
      'a[class*="comment-meta"] span[aria-hidden="true"]'
    ],
    commentAuthorHeadline: [
      '.comments-comment-meta__description-subtitle',
      '.comments-post-meta__headline'
    ],
    commentAuthorLink: [
      'a.comments-comment-meta__description-container',
      'a[class*="comments-post-meta"][href]',
      'a[href*="/in/"]'
    ],
    commentText: [
      '.comments-comment-item__main-content .update-components-text',
      '.comments-comment-item__main-content',
      '.comments-comment-entity__content .update-components-text',
      '.update-components-text'
    ],
    commentTime: [
      'time',
      '.comments-comment-meta__data',
      'span[class*="comment-meta"] time'
    ],
    commentReactions: [
      '.comments-comment-social-bar__reactions-count',
      'button[aria-label*="reaç" i]',
      'button[aria-label*="reaction" i]'
    ],
    commentRepliesCount: [
      '.comments-comment-social-bar__replies-count',
      'button[aria-label*="respost" i]',
      'button[aria-label*="repl" i]'
    ],
    commentAuthorBadge: [
      '.comments-comment-meta__badge',
      'span[class*="badge"]'
    ],
    commentRepliesContainer: [
      '.comments-comment-item__replies-container',
      'div[class*="replies-container"]',
      'article'
    ],

    // Botões "carregar mais" (apenas detecção de existência, para avisar o usuário)
    loadMoreComments: [
      'button.comments-comments-list__load-more-comments-button',
      'button[class*="load-more-comments"]',
      'button[aria-label*="mais comentários" i]',
      'button[aria-label*="more comments" i]'
    ]
  };
})();
