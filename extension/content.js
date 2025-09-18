// Altera Action Recorder - Content Script
// Records user interactions into chrome.storage.local under keys:
// - altera_recording: boolean
// - altera_recorder_events: array of events

(function () {
  const STORAGE_KEYS = {
    recording: 'altera_recording',
    events: 'altera_recorder_events',
    sessionId: 'altera_session_id',
    recordings: 'altera_recordings'
  };

  let isRecording = false;
  let scrollTimeoutId = null;
  let lastInputValueByElement = new WeakMap();
  let currentRecordingId = null;

  function nowMs() {
    return Date.now();
  }

  function getPageContext() {
    return {
      url: location.href,
      title: document.title
    };
  }

  function queryUnique(selector) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1;
    } catch (err) {
      return false;
    }
  }

  function escapeCssIdent(ident) {
    if (window.CSS && CSS.escape) return CSS.escape(ident);
    // Fallback minimal escape
    return (ident || '').replace(/([#.;,:>+~*^$|\\\\[\\\\]\\s])/g, '\\\\$1');
  }

  function getMeaningfulAttributes(element) {
    const attrs = {};
    const candidates = [
      'data-testid',
      'data-test',
      'data-qa',
      'aria-label',
      'name',
      'role',
      'placeholder',
      'type'
    ];
    for (const attr of candidates) {
      const value = element.getAttribute && element.getAttribute(attr);
      if (value) attrs[attr] = value;
    }
    return attrs;
  }

  function isClickable(element) {
    const tag = (element.tagName || '').toLowerCase();
    if (['button', 'a', 'input'].includes(tag)) return true;
    const role = element.getAttribute && element.getAttribute('role');
    if (role && /button|link|tab|menuitem/.test(role)) return true;
    const onclick = element.getAttribute && element.getAttribute('onclick');
    if (onclick) return true;
    const style = window.getComputedStyle(element);
    return style.cursor === 'pointer';
  }

  function elementTextSummary(element) {
    const text = (element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.length > 60 ? text.slice(0, 57) + '…' : text;
  }

  function buildSelectorFromAttributes(element) {
    const id = element.id;
    if (id) {
      const idSelector = `#${escapeCssIdent(id)}`;
      if (queryUnique(idSelector)) return idSelector;
    }

    const attrMap = getMeaningfulAttributes(element);
    const tag = (element.tagName || '').toLowerCase();

    const prioritizedAttrs = ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder', 'role'];
    for (const attr of prioritizedAttrs) {
      const value = attrMap[attr];
      if (!value) continue;
      const selector = `${tag}[${attr}="${escapeCssIdent(value)}"]`;
      if (queryUnique(selector)) return selector;
    }

    // Text-based for clickable elements (not standard CSS in browser; skip for now)
    return null;
  }

  function buildNthOfTypePath(element, maxDepth = 5) {
    const path = [];
    let current = element;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < maxDepth) {
      const tag = current.tagName.toLowerCase();
      let selector = tag;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(el => el.tagName.toLowerCase() === tag);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      // Try uniqueness early
      const candidate = path.join('>');
      if (queryUnique(candidate)) return candidate;
      current = parent;
      depth += 1;
    }
    return path.join('>');
  }

  function computeCssSelector(element) {
    if (!(element instanceof Element)) return null;
    // Prefer strong attributes/id
    const attrSelector = buildSelectorFromAttributes(element);
    if (attrSelector && queryUnique(attrSelector)) return attrSelector;
    // Fallback to nth-of-type path
    const nthPath = buildNthOfTypePath(element, 7);
    return nthPath || null;
  }

  function computeSelectors(element) {
    if (!(element instanceof Element)) return [];
    const selectors = [];
    const id = element.id;
    if (id) {
      const idSel = `#${escapeCssIdent(id)}`;
      if (queryUnique(idSel)) selectors.push(idSel);
    }
    const attrSel = buildSelectorFromAttributes(element);
    if (attrSel && !selectors.includes(attrSel)) selectors.push(attrSel);
    const nthPath = buildNthOfTypePath(element, 7);
    if (nthPath && !selectors.includes(nthPath)) selectors.push(nthPath);
    return selectors;
  }

  function createEventPayload(type, payload) {
    return {
      type,
      timestamp: nowMs(),
      page: getPageContext(),
      recordingId: currentRecordingId,
      ...payload
    };
  }

  async function appendEvent(eventObj) {
    try {
      const { [STORAGE_KEYS.events]: existing = [] } = await chrome.storage.local.get([STORAGE_KEYS.events]);
      existing.push(eventObj);
      await chrome.storage.local.set({ [STORAGE_KEYS.events]: existing });
    } catch (err) {
      console.warn('Failed to append event', err);
    }
  }

  function handleClick(e) {
    if (!isRecording) return;
    const target = e.target;
    const selectors = computeSelectors(target);
    const selector = selectors[0];
    if (!selector) return;
    const eventObj = createEventPayload('click', {
      selector,
      selectors,
      button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
      modifiers: {
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey
      }
    });
    appendEvent(eventObj);
  }

  function handleInput(e) {
    if (!isRecording) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return;
    const selectors = computeSelectors(target);
    const selector = selectors[0];
    if (!selector) return;
    const currentValue = target.isContentEditable ? target.innerText : target.value;
    const previousValue = lastInputValueByElement.get(target);
    lastInputValueByElement.set(target, currentValue);
    if (currentValue === previousValue) return;
    const eventObj = createEventPayload('fill', {
      selector,
      selectors,
      value: currentValue
    });
    appendEvent(eventObj);
  }

  function handleKeydown(e) {
    if (!isRecording) return;
    if (e.key !== 'Enter' && e.key !== 'Escape' && e.key.length !== 1) return;
    const active = document.activeElement;
    const selectors = active ? computeSelectors(active) : [];
    const selector = selectors[0] || null;
    const eventObj = createEventPayload('press', {
      key: e.key,
      selector,
      selectors
    });
    appendEvent(eventObj);
  }

  function handleScroll() {
    if (!isRecording) return;
    if (scrollTimeoutId) window.clearTimeout(scrollTimeoutId);
    scrollTimeoutId = window.setTimeout(() => {
      const eventObj = createEventPayload('scroll', {
        x: window.scrollX,
        y: window.scrollY
      });
      appendEvent(eventObj);
      scrollTimeoutId = null;
    }, 200);
  }

  function recordViewport() {
    const eventObj = createEventPayload('viewport', {
      width: window.innerWidth,
      height: window.innerHeight
    });
    appendEvent(eventObj);
  }

  function recordNavigation(kind) {
    const eventObj = createEventPayload('navigate', {
      url: location.href,
      kind
    });
    appendEvent(eventObj);
  }

  function attachListeners() {
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('scroll', handleScroll, { passive: true });
  }

  function detachListeners() {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('scroll', handleScroll);
  }

  async function startRecording() {
    if (isRecording) return;
    isRecording = true;
    currentRecordingId = `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await chrome.storage.local.set({ [STORAGE_KEYS.sessionId]: currentRecordingId, [STORAGE_KEYS.events]: [] });
    
    // Notify background script
    try {
      await chrome.runtime.sendMessage({ 
        type: 'BACKGROUND_CONTROL', 
        action: 'startRecording' 
      });
    } catch (error) {
      console.warn('Failed to notify background script of recording start:', error);
    }
    
    attachListeners();
    recordViewport();
    recordNavigation('start');
    console.log('Recording started with ID:', currentRecordingId);
  }

  async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    detachListeners();
    
    // Notify background script
    try {
      await chrome.runtime.sendMessage({ 
        type: 'BACKGROUND_CONTROL', 
        action: 'stopRecording' 
      });
    } catch (error) {
      console.warn('Failed to notify background script of recording stop:', error);
    }
    
    console.log('Recording stopped');
    // Do not auto-save; user controls saving via popup
  }

  (function wrapHistory() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
      const ret = origPush.apply(this, arguments);
      recordNavigation('pushState');
      return ret;
    };
    history.replaceState = function () {
      const ret = origReplace.apply(this, arguments);
      recordNavigation('replaceState');
      return ret;
    };
    window.addEventListener('popstate', () => recordNavigation('popstate'));
  })();

  async function syncRecordingFlag() {
    const { [STORAGE_KEYS.recording]: flag = false } = await chrome.storage.local.get([STORAGE_KEYS.recording]);
    isRecording = Boolean(flag);
    if (isRecording) {
      attachListeners();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'RECORDER_CONTROL') return;
    const { action } = message;
    if (action === 'ping') {
      sendResponse({ ok: true, status: 'content script ready' });
    } else if (action === 'syncState') {
      // Synchronize state with background script
      syncRecordingFlag().then(() => {
        sendResponse({ ok: true, recording: isRecording });
      });
      return true;
    } else if (action === 'start') {
      chrome.storage.local.set({ [STORAGE_KEYS.recording]: true }).then(startRecording);
      sendResponse({ ok: true });
    } else if (action === 'stop') {
      chrome.storage.local.set({ [STORAGE_KEYS.recording]: false }).then(stopRecording);
      sendResponse({ ok: true });
    } else if (action === 'clear') {
      chrome.storage.local.set({ [STORAGE_KEYS.events]: [] }).then(() => sendResponse({ ok: true }));
      return true;
    } else if (action === 'getEvents') {
      chrome.storage.local.get([STORAGE_KEYS.events, STORAGE_KEYS.recording]).then((res) => {
        sendResponse({ ok: true, events: res[STORAGE_KEYS.events] || [], recording: !!res[STORAGE_KEYS.recording] });
      });
      return true;
    } else if (action === 'saveRecording') {
      const { name, thumb, id } = message;
      chrome.storage.local.get([STORAGE_KEYS.events, STORAGE_KEYS.recordings]).then((res) => {
        const recordings = res[STORAGE_KEYS.recordings] || {};
        const recId = id || currentRecordingId || `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const recName = name || `Recording ${new Date().toLocaleString()}`;
        // If existing recording with same id or name exists, update it in place
        let targetId = recId;
        for (const [rid, rec] of Object.entries(recordings)) {
          if ((id && rid === id) || (!id && (rec.name === recName))) {
            targetId = rid;
            break;
          }
        }
        recordings[targetId] = { id: targetId, name: recName, events: res[STORAGE_KEYS.events] || [], meta: { id: targetId, name: recName, savedAt: Date.now(), thumb: thumb || null } };
        chrome.storage.local.set({ [STORAGE_KEYS.recordings]: recordings }).then(() => sendResponse({ ok: true, id: recId, name: recName }));
      });
      return true;
    } else if (action === 'listRecordings') {
      chrome.storage.local.get([STORAGE_KEYS.recordings]).then((res) => {
        const recordings = res[STORAGE_KEYS.recordings] || {};
        const items = Object.values(recordings).map(r => ({ id: r.id || r.meta?.id, name: r.name || r.meta?.name || (r.id || 'unnamed'), savedAt: r.meta?.savedAt || 0, thumb: r.meta?.thumb || null }));
        sendResponse({ ok: true, items });
      });
      return true;
    } else if (action === 'loadRecording') {
      const { id } = message;
      chrome.storage.local.get([STORAGE_KEYS.recordings]).then((res) => {
        const recordings = res[STORAGE_KEYS.recordings] || {};
        const data = recordings[id];
        const events = Array.isArray(data) ? data : (data && data.events) || [];
        sendResponse({ ok: true, events });
      });
      return true;
    } else if (action === 'deleteRecording') {
      const { id } = message;
      chrome.storage.local.get([STORAGE_KEYS.recordings]).then((res) => {
        const recordings = res[STORAGE_KEYS.recordings] || {};
        delete recordings[id];
        chrome.storage.local.set({ [STORAGE_KEYS.recordings]: recordings }).then(() => sendResponse({ ok: true }));
      });
      return true;
    } else if (action === 'replayInline') {
      const { events } = message;
      replayInline(events || []).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    } else if (action === 'diagnose') {
      // Provide a quick diagnosis payload for the popup to display
      const info = {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        hasPrompt: !!document.querySelector('#prompt-textarea'),
      };
      sendResponse({ ok: true, info });
    }
    return undefined;
  });

  syncRecordingFlag();

  // ------- Inline replayer (simple DOM-based) -------
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return !!(rect.width || rect.height) && style.visibility !== 'hidden' && style.display !== 'none';
  }

  async function waitForAnySelector(selectors, timeout = 15000) {
    const start = nowMs();
    while (nowMs() - start < timeout) {
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el && isVisible(el)) return el;
        } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Element not found for selectors: ' + selectors.join(' | '));
  }

  let overlayEl = null;
  function highlight(el) {
    try {
      if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.style.position = 'fixed';
        overlayEl.style.zIndex = '2147483647';
        overlayEl.style.border = '2px solid #1e90ff';
        overlayEl.style.pointerEvents = 'none';
        document.documentElement.appendChild(overlayEl);
      }
      const r = el.getBoundingClientRect();
      overlayEl.style.left = r.left + 'px';
      overlayEl.style.top = r.top + 'px';
      overlayEl.style.width = r.width + 'px';
      overlayEl.style.height = r.height + 'px';
    } catch (e) {}
  }
  function hideHighlight() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }

  async function replayInline(events) {
    if (!events || !events.length) {
      throw new Error('No events to replay');
    }
    const firstWithUrl = events.find(ev => ev && ev.page && ev.page.url);
    if (firstWithUrl && firstWithUrl.page && firstWithUrl.page.url) {
      try {
        const recHost = new URL(firstWithUrl.page.url).host;
        const currHost = location.host;
        if (recHost && currHost && recHost !== currHost) {
          throw new Error(`Host mismatch: current ${currHost}, recording ${recHost}`);
        }
      } catch (e) {}
    }
    for (const ev of events) {
      try {
      if (ev.type === 'navigate') {
        // Skip cross-page navigation in inline mode
        continue;
      }
      if (ev.type === 'viewport') continue;
      if (ev.type === 'scroll') {
        window.scrollTo(ev.x || 0, ev.y || 0);
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      const selectors = ev.selectors && ev.selectors.length ? ev.selectors : (ev.selector ? [ev.selector] : []);
      if (!selectors.length) continue;
      const el = await waitForAnySelector(selectors, 15000);
      highlight(el);
      if (ev.type === 'click') {
        el.focus();
        el.click();
      } else if (ev.type === 'fill') {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          el.value = String(ev.value ?? '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.isContentEditable) {
          el.focus();
          el.innerText = String(ev.value ?? '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          el.focus();
        }
      } else if (ev.type === 'press') {
        el.focus();
        const down = new KeyboardEvent('keydown', { key: ev.key, bubbles: true });
        const up = new KeyboardEvent('keyup', { key: ev.key, bubbles: true });
        el.dispatchEvent(down);
        el.dispatchEvent(up);
      }
      await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        console.warn('Replay warning:', err);
      }
    }
    hideHighlight();
  }
})();


