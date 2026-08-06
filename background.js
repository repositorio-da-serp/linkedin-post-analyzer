/**
 * background.js (service worker, MV3)
 * Responsabilidades:
 *  - Abrir o side panel ao clicar no ícone da extensão.
 *  - Validar se a aba ativa é uma publicação do LinkedIn.
 *  - Injetar selectors.js + utils.js + content.js sob demanda e devolver o payload.
 *  - Persistir/limpar o estado em chrome.storage.local.
 *
 * O service worker NÃO analisa dados nem fala com serviços externos.
 * A análise roda no painel; chamadas de IA partem do painel após consentimento.
 */

const POST_URL_PATTERNS = [
  /^https:\/\/www\.linkedin\.com\/feed\/update\//,
  /^https:\/\/www\.linkedin\.com\/posts\//,
  /^https:\/\/www\.linkedin\.com\/pulse\//,
  /^https:\/\/www\.linkedin\.com\/embed\/feed\/update\//
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function isPostUrl(url) {
  return !!url && POST_URL_PATTERNS.some(re => re.test(url));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function checkPage() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) return { status: 'NO_TAB' };
  if (!/^https:\/\/www\.linkedin\.com\//.test(tab.url)) return { status: 'NOT_LINKEDIN', url: tab.url };
  if (!isPostUrl(tab.url)) return { status: 'LINKEDIN_NOT_POST', url: tab.url };
  return { status: 'POST_PAGE', url: tab.url, tabId: tab.id };
}

async function extract() {
  const page = await checkPage();
  if (page.status !== 'POST_PAGE') return { ok: false, error: 'INVALID_PAGE', page };

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: page.tabId },
      files: ['selectors.js', 'utils.js', 'content.js']
    });
    const payload = results && results[0] ? results[0].result : null;
    if (!payload) return { ok: false, error: 'EMPTY_RESULT', message: 'A extração não retornou dados. Recarregue a página e tente novamente.' };
    return payload;
  } catch (e) {
    return { ok: false, error: 'INJECTION_FAILED', message: String(e && e.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'CHECK_PAGE':
        sendResponse(await checkPage());
        break;
      case 'EXTRACT':
        sendResponse(await extract());
        break;
      case 'SAVE_STATE':
        await chrome.storage.local.set({ lpa_state: msg.state });
        sendResponse({ ok: true });
        break;
      case 'LOAD_STATE': {
        const { lpa_state } = await chrome.storage.local.get('lpa_state');
        sendResponse({ ok: true, state: lpa_state || null });
        break;
      }
      case 'CLEAR_STATE':
        await chrome.storage.local.remove(['lpa_state']);
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
    }
  })();
  return true; // resposta assíncrona
});
