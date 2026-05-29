// AI Web Translator - Content Script
// Injects translation buttons and handles selection-based translation

// ========== State ==========
let isTranslated = false;
let translatedCache = null;
let abortController = null;
let isTranslating = false;

// User-friendly error messages
const ERR_MSGS = {
  'API_KEY_MISSING': '请在弹窗中设置 API Key',
  'API_URL_MISSING': '请在弹窗中设置 API 地址',
  'API_URL_INVALID': 'API 地址格式无效',
  'NETWORK_ERROR': '网络连接失败，请检查网络',
  'AUTH_FAILED': 'API Key 无效，请检查',
  'INSUFFICIENT_FUNDS': 'API 余额不足，请充值',
  'ACCESS_DENIED': 'API 访问被拒绝',
  'RATE_LIMIT': 'RATE_LIMIT',
  'API_ERROR': 'API 请求失败，请检查配置',
  'EMPTY_RESPONSE': 'API 返回为空，请检查模型名称'
};

// ========== Inject Buttons ==========
function injectButtons() {
  if (document.getElementById('claw-btns')) return;
  const container = document.createElement('div');
  container.id = 'claw-btns';
  container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483646;display:flex;flex-direction:column;gap:8px;cursor:grab;user-select:none';
  container.appendChild(createBtn('pause', '\u23F8', 'Pause translation', handlePause));
  container.appendChild(createBtn('translate', '\uD83C\uDF10', 'Translate page', handleTranslate));
  document.body.appendChild(container);
  makeDraggable(container);
  updateBtns();
}

function makeDraggable(el) {
  let ox, oy, sx, sy, dragging = false;
  const threshold = 4;
  el.addEventListener('mousedown', (e) => {
    if (e.target !== el) return;
    dragging = false; sx = e.clientX; sy = e.clientY;
    const rect = el.getBoundingClientRect();
    ox = e.clientX - rect.left; oy = e.clientY - rect.top;
    el.style.cursor = 'grabbing'; el.style.transition = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (el.style.cursor !== 'grabbing') return;
    if (Math.abs(e.clientX - sx) > threshold || Math.abs(e.clientY - sy) > threshold) dragging = true;
    if (!dragging) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(0, Math.min(e.clientX - ox, window.innerWidth - w)) + 'px';
    el.style.top = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - h)) + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => { if (el.style.cursor === 'grabbing') el.style.cursor = 'grab'; });
}

function createBtn(id, icon, title, handler) {
  const btn = document.createElement('div');
  btn.id = `claw-${id}-btn`;
  btn.innerHTML = icon;
  btn.title = title;
  btn.style.cssText = 'width:44px;height:44px;border-radius:50%;background:#1a73e8;color:#fff;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.3);user-select:none;transition:background 0.3s,transform 0.15s';
  btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.1)'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
  btn.addEventListener('click', handler);
  return btn;
}

function getBtn(id) { return document.getElementById(`claw-${id}-btn`); }

function updateBtns() {
  const p = getBtn('pause'), t = getBtn('translate');
  if (!p || !t) return;
  if (isTranslating) {
    p.innerHTML = '\u23F8'; p.title = 'Pause'; p.style.background = '#f5a623'; p.style.opacity = '1';
    t.innerHTML = '\uD83C\uDF10'; t.title = 'Translating...'; t.style.background = '#1a73e8'; t.style.opacity = '0.4';
  } else if (translatedCache && translatedCache.doneCount < translatedCache.totalCount) {
    p.innerHTML = '\u25B6\uFE0F'; p.title = 'Resume'; p.style.background = '#1a73e8'; p.style.opacity = '1';
    t.innerHTML = '\u21A9\uFE0F'; t.title = 'Restore original'; t.style.background = '#ea4335'; t.style.opacity = '1';
  } else if (isTranslated) {
    p.innerHTML = '\u23F8'; p.title = 'Done'; p.style.opacity = '0.4';
    t.innerHTML = '\u21A9\uFE0F'; t.title = 'Restore original'; t.style.background = '#ea4335'; t.style.opacity = '1';
  } else {
    p.innerHTML = '\u23F8'; p.title = 'Pause'; p.style.opacity = '0.4';
    t.innerHTML = '\uD83C\uDF10'; t.title = 'Translate page to Chinese'; t.style.background = '#1a73e8'; t.style.opacity = '1';
  }
}

// ========== Button Handlers ==========
async function handleTranslate() {
  if (isTranslating) return;
  if (translatedCache && translatedCache.doneCount < translatedCache.totalCount) { restorePage(); return; }
  if (isTranslated) { restorePage(); return; }
  if (translatedCache && translatedCache.doneCount >= translatedCache.totalCount) { applyCache(); return; }
  await startNewTranslation();
}

async function handlePause() {
  if (isTranslating) { stopTranslation(); return; }
  if (!translatedCache || translatedCache.doneCount >= translatedCache.totalCount) return;
  applyPartialCache();
  await doTranslate(translatedCache.doneCount);
}

// ========== Translate ==========
const CACHE_KEY = 'ait_page_cache';
const CACHE_MAX_AGE = 7 * 86400000; // 7 days
let currentUrl = location.href.replace(/#.*$/, ''); // cache key

async function startNewTranslation() {
  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || !parent.offsetParent) return NodeFilter.FILTER_REJECT;
      if (['SCRIPT','STYLE','NOSCRIPT','CODE','PRE'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      const text = node.textContent.trim();
      if (text.length < 2) return NodeFilter.FILTER_REJECT;
      if ((text.match(/[\u4e00-\u9fff]/g) || []).length / text.length > 0.7) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  if (nodes.length === 0) {
    const t = getBtn('translate');
    t.innerHTML = '\u26A0\uFE0F'; t.title = 'No translatable content';
    setTimeout(updateBtns, 2000);
    return;
  }

  // Check persistent cache first
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const urlCache = (stored[CACHE_KEY] || {})[currentUrl];
  if (urlCache && urlCache.texts) {
    // Try to match cached translations to current nodes
    const cacheMap = {};
    for (let i = 0; i < urlCache.texts.length; i++) {
      cacheMap[urlCache.texts[i]] = urlCache.translations[i];
    }
    let hits = 0;
    const items = [];
    for (const node of nodes) {
      const orig = node.textContent.trim();
      const cached = cacheMap[orig];
      items.push({ node, original: orig, translated: cached || null });
      if (cached) hits++;
    }
    if (hits > nodes.length * 0.5) {
      // Cache covers most content — apply immediately, translate the rest
      translatedCache = { items, totalCount: nodes.length, doneCount: 0 };
      for (const item of items) {
        if (item.translated) {
          item.node.textContent = item.translated;
          translatedCache.doneCount++;
        }
      }
      if (translatedCache.doneCount < nodes.length) {
        // Translate remaining uncached texts
        isTranslating = true;
        abortController = new AbortController();
        updateBtns();
        await doTranslate(translatedCache.doneCount);
        // Save updated cache
        await savePageCache();
      } else {
        isTranslated = true;
        updateBtns();
      }
      return;
    }
  }

  // No cache or low hit rate — full translation
  translatedCache = {
    items: nodes.map(n => ({ node: n, original: n.textContent.trim(), translated: null })),
    totalCount: nodes.length, doneCount: 0
  };
  await doTranslate(0);
  // Save to persistent cache
  await savePageCache();
}

async function savePageCache() {
  if (!translatedCache) return;
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const all = stored[CACHE_KEY] || {};
  // Evict old entries
  const now = Date.now();
  for (const url of Object.keys(all)) {
    if (now - all[url].ts > CACHE_MAX_AGE) delete all[url];
  }
  // Trim to 20 most recent URLs
  const urls = Object.keys(all).sort((a, b) => all[b].ts - all[a].ts).slice(0, 19);
  const trimmed = {};
  for (const url of urls) trimmed[url] = all[url];
  // Save current
  trimmed[currentUrl] = {
    texts: translatedCache.items.map(it => it.original),
    translations: translatedCache.items.map(it => it.translated || it.original),
    ts: Date.now()
  };
  // Estimate size and trim if needed (chrome.storage limit ~10MB)
  const json = JSON.stringify(trimmed);
  if (json.length > 5e6) {
    // Too big — keep only last 5 URLs
    const keys = Object.keys(trimmed).sort((a, b) => trimmed[b].ts - trimmed[a].ts).slice(0, 5);
    const small = {};
    for (const k of keys) small[k] = trimmed[k];
    await chrome.storage.local.set({ [CACHE_KEY]: small });
  } else {
    await chrome.storage.local.set({ [CACHE_KEY]: trimmed });
  }
}

async function doTranslate(startIndex) {
  if (!translatedCache) return;
  abortController = new AbortController();
  isTranslating = true;
  updateBtns();

  const items = translatedCache.items;
  const stored = await chrome.storage.local.get('platform');
  const delay = (stored.platform === 'openrouter') ? 2500 : 100;

  for (let i = startIndex; i < items.length; i += 8) {
    if (abortController.signal.aborted) break;
    const batch = items.slice(i, i + 8).filter(it => !it.translated);
    if (!batch.length) { translatedCache.doneCount = items.length; break; }

    // Deduplicate: same text only translated once
    const uniqueTexts = [];
    const seenMap = {};
    for (const item of batch) {
      const t = item.original.trim();
      if (!t) continue;
      if (!seenMap[t]) { seenMap[t] = []; uniqueTexts.push(t); }
      seenMap[t].push(item);
    }
    if (!uniqueTexts.length) continue;

    try {
      const translated = await callWithRetry(() => callTranslateAPI(uniqueTexts));
      for (let ti = 0; ti < uniqueTexts.length; ti++) {
        const tr = translated[ti];
        if (tr && tr !== uniqueTexts[ti]) {
          for (const item of (seenMap[uniqueTexts[ti]] || [])) {
            item.translated = tr;
            item.node.textContent = tr;
          }
        } else {
          for (const item of (seenMap[uniqueTexts[ti]] || [])) {
            item.translated = item.original;
          }
        }
      }
      translatedCache.doneCount = Math.min(i + 8, items.length);
    } catch (e) {
      const code = e.message || '';
      if (code === 'RATE_LIMIT') {
        getBtn('pause').title = 'Rate limited, waiting...';
        await sleep(10000);
        i -= 8;
        continue;
      }
      for (const item of batch) { if (!item.translated) item.translated = item.original; }
      translatedCache.doneCount = Math.min(i + 8, items.length);
      const friendly = ERR_MSGS[code] || 'Translation failed';
      getBtn('pause').innerHTML = '\u26A0\uFE0F';
      getBtn('pause').title = friendly;
      getBtn('pause').style.background = '#d93025';
      await sleep(3000);
      isTranslating = false; abortController = null; updateBtns();
      return;
    }
    getBtn('pause').title = 'Translating ' + Math.round(Math.min(translatedCache.doneCount,items.length)/items.length*100) + '%';
  }

  isTranslating = false; abortController = null;
  if (translatedCache.doneCount >= items.length) isTranslated = true;
  updateBtns();
}

function stopTranslation() {
  if (abortController) { abortController.abort(); abortController = null; }
  isTranslating = false;
  updateBtns();
}

function restorePage() {
  if (!translatedCache) return;
  for (const item of translatedCache.items) item.node.textContent = item.original;
  isTranslated = false;
  updateBtns();
}

function applyPartialCache() {
  if (!translatedCache) return;
  for (const item of translatedCache.items) if (item.translated) item.node.textContent = item.translated;
  isTranslated = false;
}

function applyCache() {
  if (!translatedCache) return;
  for (const item of translatedCache.items) if (item.translated) item.node.textContent = item.translated;
  isTranslated = true;
  updateBtns();
}

// ========== Selection Translation (via context menu) ==========
let popup = null;

function ensurePopup() {
  if (popup) return;
  popup = document.createElement('div');
  popup.id = 'ait-popup';
  popup.style.cssText = 'position:fixed;z-index:2147483647;background:#fff;color:#333;border:1px solid #ddd;border-radius:8px;padding:12px 16px;box-shadow:0 4px 20px rgba(0,0,0,0.15);font-size:14px;font-family:sans-serif;max-width:420px;display:none;line-height:1.7;word-break:break-word';
  document.body.appendChild(popup);
}

function showPopup(x, y, html) {
  ensurePopup();
  popup.style.display = 'block';
  popup.style.left = Math.min(x, window.innerWidth - 440) + 'px';
  popup.style.top = (y + 10 > window.innerHeight ? y - 70 : y + 10) + 'px';
  popup.innerHTML = html;
}

// Listen for translation results from background.js (context menu)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'showTranslation') {
    const sel = window.getSelection();
    let x = 100, y = 100;
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      x = rect.left; y = rect.bottom;
    }
    if (msg.translated) {
      showPopup(x, y,
        '<div style="color:#666;margin-bottom:6px;font-size:12px">' + esc(msg.original) + '</div>' +
        '<div style="color:#1a73e8;font-weight:500">' + esc(msg.translated) + '</div>'
      );
    } else {
      showPopup(x, y, '<span style="color:red">' + esc(msg.error || 'Failed') + '</span>');
    }
  }
});

document.addEventListener('mousedown', (e) => {
  if (popup && !popup.contains(e.target)) popup.style.display = 'none';
});

// ========== Utilities ==========
async function callWithRetry(fn, n) {
  n = n || 3;
  for (let i = 0; i < n; i++) {
    try { return await fn(); }
    catch (e) { if (e.message === 'RATE_LIMIT' && i < n - 1) { await sleep(3000 * (i + 1)); continue; } throw e; }
  }
}

function callTranslateAPI(texts) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'translate', texts: texts }, function(r) {
      if (chrome.runtime.lastError) reject(new Error('EXT_ERROR'));
      else if (r.error) reject(new Error(r.error));
      else resolve(r.translated);
    });
  });
}

// Safe HTML escape - uses textContent to prevent XSS
function esc(str) {
  var el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

if (document.body) injectButtons();
else document.addEventListener('DOMContentLoaded', injectButtons);
