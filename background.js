// AI Web Translator - Background Service Worker
// Handles API calls to avoid CORS issues

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslate(request.texts)
      .then(translated => sendResponse({ translated }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

async function handleTranslate(texts) {
  const stored = await chrome.storage.local.get(['platform', 'api_url', 'model', 'api_key']);
  const url = stored.api_url;
  const key = stored.api_key;
  const model = stored.model || 'deepseek-chat';
  const platform = stored.platform || 'deepseek';

  if (!key) throw new Error('API_KEY_MISSING');
  if (!url) throw new Error('API_URL_MISSING');

  // Basic URL validation
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch { throw new Error('API_URL_INVALID'); }

  const prompt = [
    'Translate the following text into Chinese.',
    'Auto-detect the source language (English, Japanese, Korean, French, German, Spanish, Russian, etc.).',
    'Return only the Chinese translation, one per segment, separated by "---".',
    'Do NOT add any explanations, pinyin, or original text:',
    '',
    texts.join('\n===\n')
  ].join('\n');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`
  };

  if (platform === 'openrouter') {
    // Use extension ID as referer; falls back to a generic value
    const extId = chrome.runtime.id || 'ai-web-translator';
    headers['HTTP-Referer'] = `https://${extId}.extension`;
    headers['X-Title'] = 'AI Web Translator';
  }

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 4000
  };

  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error('NETWORK_ERROR');
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let errCode = `${response.status}`;
    try {
      const errJson = JSON.parse(errText);
      const errMsg = errJson.error?.message || errJson.message || '';
      if (response.status === 401) throw new Error('AUTH_FAILED');
      if (response.status === 402) throw new Error('INSUFFICIENT_FUNDS');
      if (response.status === 429) throw new Error('RATE_LIMIT');
      if (response.status === 403) throw new Error('ACCESS_DENIED');
      throw new Error('API_ERROR');
    } catch (e) {
      if (e.message !== 'API_ERROR') throw e;
    }
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
