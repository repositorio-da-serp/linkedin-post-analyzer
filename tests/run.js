/**
 * tests/run.js
 * Testes das funções puras (utils.js e analysis.js) em Node, sem dependências.
 * Uso: node tests/run.js
 */
'use strict';

const path = require('path');
const U = require(path.join(__dirname, '..', 'utils.js'));
const A = require(path.join(__dirname, '..', 'analysis.js'));

let passed = 0, failed = 0;
function t(name, cond, extra) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.error('FALHA ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
function eq(name, got, want) { t(name, JSON.stringify(got) === JSON.stringify(want), { got, want }); }

// ------------------------------------------------------------------ utils

console.log('\n[utils.parseCount]');
eq('exato simples', U.parseCount('347'), { raw: '347', normalized: 347, precision: 'exact', available: true });
eq('milhar pt (1.234)', U.parseCount('1.234').normalized, 1234);
eq('milhar en (12,345)', U.parseCount('12,345').normalized, 12345);
t('milhar é exact', U.parseCount('1.234').precision === 'exact');
eq('abreviado pt (1,2 mil)', U.parseCount('1,2 mil').normalized, 1200);
t('abreviado pt precision', U.parseCount('1,2 mil').precision === 'abbreviated');
eq('abreviado pt inteiro (12 mil)', U.parseCount('12 mil').normalized, 12000);
eq('abreviado en (1.2K)', U.parseCount('1.2K').normalized, 1200);
eq('milhões (3 mi)', U.parseCount('3 mi').normalized, 3000000);
eq('milhões en (2M)', U.parseCount('2M').normalized, 2000000);
t('vazio indisponível', U.parseCount('').available === false);
t('nulo indisponível', U.parseCount(null).available === false && U.parseCount(null).precision === 'unavailable');
eq('de texto livre', U.parseCountFromText('347 comentários').normalized, 347);
eq('de aria-label', U.parseCountFromText('1,2 mil reações em publicação').normalized, 1200);

console.log('\n[utils.texto]');
eq('cleanText nbsp/zwsp', U.cleanText('a\u00a0b\u200b c'), 'a b c');
eq('hashtags', U.extractHashtags('Sobre #Marketing e #vendasB2B'), ['#marketing', '#vendasb2b']);
eq('urls', U.extractUrls('veja https://ex.com/a?b=1 fim').length, 1);
eq('url não engole emoji', U.extractUrls('👉https://lnkd.in/dJM3vzKV🇧🇷 Curso')[0], 'https://lnkd.in/dJM3vzKV');
eq('url remove pontuação final', U.extractUrls('acesse https://ex.com/a.')[0], 'https://ex.com/a');
t('emojiOnly positivo', U.isEmojiOnly('👏👏👏'));
t('emojiOnly com texto = false', !U.isEmojiOnly('bom 👏'));
eq('idioma pt', U.detectLanguage('Muito obrigado por compartilhar isso com a gente'), 'pt');
eq('idioma en', U.detectLanguage('Thanks for sharing this with the team, they will love it'), 'en');
eq('idioma unknown', U.detectLanguage('xyz 123'), 'unknown');
eq('countParagraphs', U.countParagraphs('a\n\nb\nc'), 3);
t('hash estável', U.hash('abc') === U.hash('abc') && U.hash('abc') !== U.hash('abd'));
eq('escapeCsv', U.escapeCsv('a,"b"'), '"a,""b"""');

console.log('\n[utils.stripFeedBoilerplate]');
const boiler = 'Publicação no feedDiego Ivo • SeguindoSEO, PR & AI Marketing | Fundador CEO da Conversion, a maior agência de SEO no BrasilAgende uma reunião4 d • SELECIONEI +700 CURSOS DE MARKETING GRÁTIS (e com certificado)! Curso de Marketing Estratégico na prática';
const sb = U.stripFeedBoilerplate(boiler);
t('detecta e remove cabeçalho', sb.stripped, sb);
eq('nome do autor', sb.author && sb.author.name, 'Diego Ivo');
t('headline capturada', sb.author && /SEO, PR & AI Marketing/.test(sb.author.headline || ''), sb.author);
eq('tempo', sb.timeLabel, '4 d');
t('texto começa no conteúdo real', sb.text.startsWith('SELECIONEI +700 CURSOS'), sb.text.slice(0, 60));
const noHeader = U.stripFeedBoilerplate('Hoje aprendi que 30 min de foco valem por 3 h dispersas. E você?');
t('não remove nada sem evidência de cabeçalho', !noHeader.stripped && noHeader.text.startsWith('Hoje aprendi'), noHeader);
const enHeader = U.stripFeedBoilerplate('Feed postJane Doe • FollowingHead of Growth at Acme2 w • Here is what I learned about retention after 5 years running experiments.');
t('cabeçalho em inglês', enHeader.stripped && enHeader.author.name === 'Jane Doe' && enHeader.text.startsWith('Here is what'), enHeader);

console.log('\n[utils.adjacentCount]');
eq('número antes da palavra', U.adjacentCount('85 compartilhamentos', 'compartilhamentos?').normalized, 85);
eq('palavra antes do número', U.adjacentCount('comentários: 11', 'coment[aá]rios?').normalized, 11);
eq('abreviado', U.adjacentCount('1,2 mil reações em publicação', 'reaç\\w*').normalized, 1200);
t('sem adjacência = null', U.adjacentCount('João 2º comentou sobre reações', 'reaç\\w*') === null);
t('sem número = null', U.adjacentCount('muitas reações', 'reaç\\w*') === null);

console.log('\n[utils.duplicatedPrefix]');
eq('nome duplicado em cabeçalho achatado',
  U.duplicatedPrefix('Daniel Bender Usuário verificado Perfil 2ºDaniel Bender • 2ºHead de Ecommerce'),
  'Daniel Bender');
eq('nome de três palavras',
  U.duplicatedPrefix('Ana Clara Souza Premium Perfil SeguindoAna Clara Souza • SeguindoGrowth'),
  'Ana Clara Souza');
t('sem duplicação = null', U.duplicatedPrefix('Comentário simples sem repetição de nome próprio') === null);

console.log('\n[utils.reactionsPhraseCount]');
const rp1 = U.reactionsPhraseCount('Maria Silva e outras 89 pessoas');
t('e outras N pessoas = N+1 estimated', rp1 && rp1.normalized === 90 && rp1.precision === 'estimated', rp1);
const rp1b = U.reactionsPhraseCount('Esane Barreto e mais 676 pessoas reagiramEsane Barreto e mais 676 pessoas');
t('e mais N pessoas = N+1, raw limpo', rp1b && rp1b.normalized === 677 && rp1b.precision === 'estimated' && rp1b.raw.length < 40, rp1b);
const rp2 = U.reactionsPhraseCount('90 pessoas reagiram a esta publicação');
t('N pessoas reagiram = exact', rp2 && rp2.normalized === 90 && rp2.precision === 'exact', rp2);
const rp3 = U.reactionsPhraseCount('John and 1.2K others');
t('en abreviado', rp3 && rp3.normalized === 1201, rp3);
t('frase sem contagem = null', U.reactionsPhraseCount('Gostei · Responder') === null);

console.log('\n[utils.slugify / nameFromProfileSlug]');
eq('slugify remove acentos e espaços', U.slugify('Diego Ivo'), 'diegoivo');
eq('slugify com pontuação', U.slugify('Visual-Vivo, Ltda.'), 'visualvivoltda');
eq('nome de slug hifenizado', U.nameFromProfileSlug('https://www.linkedin.com/in/mauricio-amaro/'), 'Mauricio Amaro');
eq('nome de slug com id final', U.nameFromProfileSlug('/in/gabriel-pizani-1a2b3c'), 'Gabriel Pizani');
t('token único = null', U.nameFromProfileSlug('/in/fabiosp/') === null);
t('href sem perfil = null', U.nameFromProfileSlug('https://lnkd.in/abc') === null);

console.log('\n[analysis.prepareComments]');
const prepped = A.prepareComments([
  mkComment('Parabéns, excelente conteúdo!'),
  mkComment('Parabéns, excelente conteúdo!'), // duplicado (mesmo autor/texto)
  mkComment('👏👏👏', { author: 'B' }),
  mkComment('@joao olha isso', { author: 'C' }),
  mkComment('Muito bom!', { author: 'D' })
]);
eq('deduplicação', prepped.length, 4);
t('flag emojiOnly', prepped.find(c => c.text === '👏👏👏').flags.emojiOnly);
t('flag genericOnly', prepped.find(c => c.text === 'Muito bom!').flags.genericOnly);

console.log('\n[analysis.sentimentOf]');
const s1 = A.sentimentOf(A.prepareComments([mkComment('Parabéns, conteúdo excelente e muito útil!')])[0]);
t('positivo', s1.label === 'positivo', s1);
t('positivo tem rationale e fonte rules', s1.rationale.length > 0 && s1.source === 'rules');
const s2 = A.sentimentOf(A.prepareComments([mkComment('Discordo, análise rasa e conteúdo errado.')])[0]);
t('negativo', s2.label === 'negativo', s2);
const s3 = A.sentimentOf(A.prepareComments([mkComment('Como você fez a segmentação?')])[0]);
t('pergunta neutra com curiosidade', s3.label === 'neutro' && s3.emotion === 'curiosidade', s3);
const s4 = A.sentimentOf(A.prepareComments([mkComment('👏👏👏', { author: 'B' })])[0]);
t('emoji only positivo', s4.label === 'positivo', s4);
const s5 = A.sentimentOf(A.prepareComments([mkComment('Excelente... claro que sim kkkk')])[0]);
t('ironia rebaixa confiança', s5.confidence <= 0.4, s5);

console.log('\n[analysis.clustersOf]');
const c1 = A.prepareComments([mkComment('Obrigado por compartilhar!')])[0];
c1.clusters = A.clustersOf(c1);
t('agradecimento', c1.clusters.includes('agradecimento'), c1.clusters);
const c2 = A.prepareComments([mkComment('Pode mandar o link do material?')])[0];
c2.clusters = A.clustersOf(c2);
t('pedido de material', c2.clusters.includes('pedido de material'), c2.clusters);
t('pergunta com pedido não vira dúvida', !c2.clusters.includes('dúvida'), c2.clusters);
const c3 = A.prepareComments([mkComment('@joao')])[0];
c3.clusters = A.clustersOf(c3);
t('marcação', c3.clusters.includes('marcação de outras pessoas'), c3.clusters);
const c4 = A.prepareComments([mkComment('Na minha empresa aplicamos isso e o churn caiu 15% em um trimestre.')])[0];
c4.clusters = A.clustersOf(c4);
t('experiência pessoal', c4.clusters.includes('experiência pessoal'), c4.clusters);

console.log('\n[analysis.mergeComments]');
const merged = A.mergeComments([{ id: 'a', text: '1' }, { id: 'b', text: '2' }], [{ id: 'b', text: '2v2' }, { id: 'c', text: '3' }]);
eq('união por id', merged.map(m => m.id).sort(), ['a', 'b', 'c']);
eq('novo sobrescreve', merged.find(m => m.id === 'b').text, '2v2');

// ------------------------------------------------------- pipeline completo

console.log('\n[analysis.analyze pipeline]');
const fullText = 'Eu demiti meu melhor cliente.\n\nEle representava 40% da receita. Aqui estão as 3 lições:\n1. Concentração é risco\n2. Margem importa mais que faturamento\n3. Cultura não se negocia\n\nO que você teria feito no meu lugar?';
const raw = {
  ok: true,
  meta: { url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', postId: '123', collectedAt: '2026-07-31T12:00:00.000Z', pageTitle: 't' },
  post: {
    type: 'text',
    mediaDetected: [],
    author: { name: 'Ana Souza', profileUrl: null, headline: 'CEO', company: null, connectionDegree: null, followers: { raw: '12 mil', normalized: 12000, precision: 'abbreviated', available: true }, verified: false },
    content: {
      fullText, truncatedInDom: false,
      hookText: 'Eu demiti meu melhor cliente.',
      stats: { chars: fullText.length, words: U.countWords(fullText), paragraphs: U.countParagraphs(fullText), lines: fullText.split('\n').length },
      links: [], hashtags: [], mentions: [], emojis: [], mediaAltTexts: [], mediaDescription: null,
      cta: { present: true, type: 'pergunta' }
    },
    repost: null
  },
  metrics: {
    reactions: { raw: '347', normalized: 347, precision: 'exact', available: true },
    byType: {},
    comments: { raw: '12', normalized: 12, precision: 'exact', available: true },
    reposts: { raw: '8', normalized: 8, precision: 'exact', available: true },
    views: { raw: null, normalized: null, precision: 'unavailable', available: false }
  },
  comments: [
    mkComment('Parabéns pela coragem, excelente reflexão!', { author: 'A', replies: 2 }),
    mkComment('Discordo. Sem contexto financeiro isso é irresponsável.', { author: 'B' }),
    mkComment('Passei por isso na minha empresa, comigo foi igual e valeu muito a pena.', { author: 'C' }),
    mkComment('Pode compartilhar como ficou o fluxo de caixa depois?', { author: 'D' }),
    mkComment('👏👏', { author: 'E' }),
    mkComment('Obrigado por dividir, vou aplicar esse filtro na minha carteira.', { author: 'F', parentId: null })
  ],
  coverage: { commentsLoaded: 6, commentsDeclared: 12, declaredPrecision: 'exact', ratio: 0.5, complete: false, moreAvailableInPage: true },
  diagnostics: { selectorFailures: [], warnings: [], strategiesUsed: {} }
};

const an = A.analyze(raw);
eq('idioma', an.language, 'pt');
eq('15 critérios de nota', Object.keys(an.scores).length, 15);
t('notas entre 0 e 10', Object.values(an.scores).every(s => s.score >= 0 && s.score <= 10));
t('toda nota tem justificativa', Object.values(an.scores).every(s => s.rationale && s.kind === 'heuristic'));
eq('8 índices', Object.keys(an.indices).length, 8);
t('índices 0-100 com metodologia', Object.values(an.indices).every(i => i.value >= 0 && i.value <= 100 && /não é uma métrica oficial/i.test(i.methodology)));
t('gancho: história pessoal', an.hook.categories.includes('história pessoal'), an.hook.categories);
t('todo comentário tem sentimento e clusters', an.comments.every(c => c.sentiment && c.sentiment.source === 'rules' && Array.isArray(c.clusters)));
eq('8 perguntas de diagnóstico', Object.keys(an.report.diagnosis).length, 8);
t('nota de cobertura menciona parcial', /PARCIAL/i.test(an.report.coverageNote), an.report.coverageNote);
t('motivações são hipóteses', an.motivations.comments.every(m => m.kind === 'hypothesis' && m.evidence));
t('disclaimer de motivações', /hip[óo]teses/i.test(an.motivations.disclaimer));
t('cluster experiência presente', an.aggregates.clusters.some(c => c.name === 'experiência pessoal'));
t('tema identificado', typeof an.themes.main === 'string' && an.themes.main.length > 0, an.themes);

// Re-análise preserva classificação da IA
an.comments[0].sentiment = { label: 'positivo', emotion: 'admiração', intensity: 0.8, confidence: 0.9, rationale: 'ia', source: 'ai' };
const an2 = A.analyze(raw, an.comments);
t('sentimento de IA preservado no merge', an2.comments.find(c => c.id === an.comments[0].id).sentiment.source === 'ai');

console.log('\n[analysis.mentionOnly sem @]');
const mo = A.prepareComments([Object.assign(mkComment('Melina Almo Galhardo', { author: 'Fulano' }), { mentions: ['Melina Almo Galhardo'] })])[0];
t('nome puro marcado como mentionOnly', mo.flags.mentionOnly, mo.flags);
const mo2 = A.prepareComments([Object.assign(mkComment('Melina Almo Galhardo olha este material', { author: 'Fulano' }), { mentions: ['Melina Almo Galhardo'] })])[0];
t('menção com texto não é mentionOnly', !mo2.flags.mentionOnly, mo2.flags);

console.log('\n[analysis.themes ignora URLs]');
const rawThemes = JSON.parse(JSON.stringify(raw));
rawThemes.post.content.fullText = 'Curso de marketing digital 👉 https://lnkd.in/abc https://hubs.ly/xyz marketing marketing cursos';
rawThemes.post.content.hashtags = [];
const th = A.themes(rawThemes, []);
t('tema não é token de URL', !['https', 'http', 'lnkd', 'hubs'].includes(th.main), th);

// --------------------------------------------------------------- analysis

function mkComment(text, opts = {}) {
  return Object.assign({
    id: 'c_' + U.hash(text + (opts.author || 'X')),
    parentId: opts.parentId || null,
    level: opts.level || 0,
    author: { name: opts.author || 'Fulano', headline: null, profileUrl: null },
    text,
    timeLabel: '2 sem',
    reactions: { raw: null, normalized: null, precision: 'unavailable', available: false },
    repliesCount: { raw: opts.replies != null ? String(opts.replies) : null, normalized: opts.replies ?? null, precision: opts.replies != null ? 'exact' : 'unavailable', available: opts.replies != null },
    flags: { byPostAuthor: !!opts.byAuthor, highlighted: false },
    links: U.extractUrls(text),
    mentions: U.extractMentions(text),
    hashtags: U.extractHashtags(text),
    emojis: U.extractEmojis(text)
  }, {});
}


// ---------------------------------------------------------------- resultado

console.log(`\n${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);
