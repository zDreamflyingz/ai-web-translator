// AI Web Translator - Background Service Worker

// ========== Context Menu ==========
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: 'Translate selection to Chinese',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    const text = info.selectionText.trim();
    if (text.length < 2) return;
    // Skip if already Chinese
    if (/^[\u4e00-\u9fff\s，。！？、；：""''（）《》…—\-\d]+$/.test(text)) return;

    try {
      const translated = await handleTranslate([text]);
      chrome.tabs.sendMessage(tab.id, {
        action: 'showTranslation',
        original: text,
        translated: translated[0]
      });
    } catch (e) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showTranslation',
        original: text,
        translated: null,
        error: ERR_MSGS[e.message] || 'Translation failed'
      });
    }
  }
});

// ========== Message Handler (from content.js for page translation) ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslate(request.texts)
      .then(translated => sendResponse({ translated }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

// ========== Translate API ==========
async function handleTranslate(texts) {
  const stored = await chrome.storage.local.get(['platform', 'api_url', 'model', 'api_key']);
  const url = stored.api_url;
  const key = stored.api_key;
  const model = stored.model || 'deepseek-chat';
  const platform = stored.platform || 'deepseek';

  if (!key) throw new Error('API_KEY_MISSING');
  if (!url) throw new Error('API_URL_MISSING');

  const prompt = [
    'Translate the following text into Chinese.',
    'Auto-detect the source language (English, Japanese, Korean, French, German, etc.).',
    'Return only the Chinese translation, one per segment, separated by "---".',
    'Do NOT add explanations or original text:',
    '',
    texts.join('\n===\n')
  ].join('\n');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`
  };
  if (platform === 'openrouter') {
    headers['HTTP-Referer'] = `https://${chrome.runtime.id || 'ai-web-translator'}.extension`;
    headers['X-Title'] = 'AI Web Translator';
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4000 })
    });
  } catch (e) {
    throw new Error('NETWORK_ERROR');
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error('AUTH_FAILED');
    if (response.status === 402) throw new Error('INSUFFICIENT_FUNDS');
    if (response.status === 429) throw new Error('RATE_LIMIT');
    if (response.status === 403) throw new Error('ACCESS_DENIED');
    throw new Error('API_ERROR');
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content?.trim();
  if (!result) throw new Error('EMPTY_RESPONSE');

  const parts = result.split('---').map(s => s.trim()).filter(Boolean);
  if (parts.length === texts.length) return parts;
  if (parts.length > texts.length) return parts.slice(0, texts.length);
  if (parts.length === 1 && texts.length > 1) {
    return result.split('\n').map(s => s.trim()).filter(Boolean).slice(0, texts.length);
  }
  return parts;
}

const ERR_MSGS = {
  'API_KEY_MISSING': 'API key not set',
  'API_URL_MISSING': 'API URL not set',
  'NETWORK_ERROR': 'Network error',
  'AUTH_FAILED': 'Invalid API key',
  'INSUFFICIENT_FUNDS': 'Insufficient funds',
  'ACCESS_DENIED': 'Access denied',
  'RATE_LIMIT': 'Rate limited',
  'API_ERROR': 'API error',
  'EMPTY_RESPONSE': 'Empty response'
};
