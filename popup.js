// AI Web Translator - Popup Settings
// Platform model configurations (updated May 2026)

const PLATFORM_MODELS = {
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek V4 Pro' },
    { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (fast)' }
  ],
  openrouter: [
    { value: 'deepseek/deepseek-v4-flash:free', label: 'DeepSeek V4 Flash (free)' },
    { value: 'deepseek/deepseek-chat', label: 'DeepSeek V4 Pro (paid)' },
    { value: 'meta-llama/llama-4-maverick:free', label: 'Llama 4 Maverick (free)' },
    { value: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron Omni (free)' },
    { value: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen3 Next 80B (free)' },
    { value: 'google/gemini-2.5-flash-lite-preview', label: 'Gemini 2.5 Flash Lite (cheap)' }
  ],
  openai: [
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (cheap)' }
  ],
  custom: []
};

const PLATFORMS = {
  deepseek:    { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  openrouter:  { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'deepseek/deepseek-v4-flash:free' },
  openai:      { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  custom:      { url: '', model: '' }
};

document.addEventListener('DOMContentLoaded', async () => {
  const platformEl = document.getElementById('platform');
  const apiUrlEl = document.getElementById('apiUrl');
  const apiUrlRow = document.getElementById('apiUrlRow');
  const modelSelect = document.getElementById('modelSelect');
  const modelInput = document.getElementById('modelInput');
  const apiKeyEl = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');

  function setStatus(msg, cls) { statusEl.textContent = msg; statusEl.className = cls || ''; }

  function populateModels(platform) {
    modelSelect.innerHTML = '';
    const models = PLATFORM_MODELS[platform] || [];
    if (models.length > 0) {
      modelSelect.style.display = 'block';
      modelInput.style.display = 'none';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.value; opt.textContent = m.label;
        modelSelect.appendChild(opt);
      }
    } else {
      modelSelect.style.display = 'none';
      modelInput.style.display = 'block';
    }
  }

  platformEl.addEventListener('change', () => {
    const plat = PLATFORMS[platformEl.value];
    if (platformEl.value === 'custom') {
      apiUrlRow.style.display = 'block';
      apiUrlEl.value = apiUrlEl.value || '';
    } else {
      apiUrlRow.style.display = 'none';
      apiUrlEl.value = plat.url;
    }
    populateModels(platformEl.value);
    chrome.storage.local.get('model', (stored) => {
      if (stored.model) {
        if (modelSelect.style.display !== 'none') {
          let found = false;
          for (const opt of modelSelect.options) {
            if (opt.value === stored.model) { opt.selected = true; found = true; break; }
          }
          if (!found) {
            const opt = document.createElement('option');
            opt.value = stored.model; opt.textContent = stored.model; opt.selected = true;
            modelSelect.appendChild(opt);
          }
        } else {
          modelInput.value = stored.model;
        }
      }
    });
  });

  const stored = await chrome.storage.local.get(['platform', 'api_url', 'model', 'api_key', 'targetLang']);
  if (stored.platform) platformEl.value = stored.platform;
  platformEl.dispatchEvent(new Event('change'));
  if (stored.api_url && stored.platform === 'custom') apiUrlEl.value = stored.api_url;
  if (stored.api_key) apiKeyEl.value = stored.api_key;
  if (stored.targetLang) document.getElementById('targetLang').value = stored.targetLang;

  saveBtn.addEventListener('click', async () => {
    const platform = platformEl.value;
    const key = apiKeyEl.value.trim();
    const model = modelSelect.style.display !== 'none' ? modelSelect.value.trim() : modelInput.value.trim();
    let url = apiUrlEl.value.trim();
    const targetLang = document.getElementById('targetLang').value;

    if (!key) { setStatus('Please enter API Key', 'error'); return; }
    if (!model) { setStatus('Please select a model', 'error'); return; }

    // Validate URL format
    if (platform === 'custom' || !PLATFORMS[platform].url) {
      try { const p = new URL(url); if (!['http:','https:'].includes(p.protocol)) throw new Error(); }
      catch { setStatus('Invalid API URL', 'error'); return; }
    } else {
      url = PLATFORMS[platform].url;
    }

    await chrome.storage.local.set({ platform, api_url: url, model, api_key: key, targetLang });
    setStatus('Saved! Reload page to apply', 'success');
  });

  clearBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(['platform', 'api_url', 'model', 'api_key']);
    platformEl.value = 'deepseek';
    platformEl.dispatchEvent(new Event('change'));
    apiKeyEl.value = '';
    setStatus('Cleared', '');
  });
});
