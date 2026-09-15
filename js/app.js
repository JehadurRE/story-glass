import { parseUrl, parseManualPayload, PLATFORMS } from './parser.js';
import { resolveInstagram } from './platforms/instagram.js';
import { resolveFacebook } from './platforms/facebook.js';
import { StoryPlayer, downloadMedia } from './player.js';
import { loadSettings, saveSettings, listRoutesSummary } from './fetcher.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const els = {
  form: $('#lookup-form'),
  input: $('#url-input'),
  clearBtn: $('#clear-input'),
  pasteBtn: $('#paste-clip'),
  result: $('#result'),
  status: $('#status'),
  player: $('#story-player'),
  media: $('#player-media'),
  rail: $('#player-rail'),
  meta: $('#player-meta'),
  downloadBtn: $('#download-current'),
  openBtn: $('#open-current'),
  platformBadge: $('#platform-badge'),
  hint: $('#result-hint'),
  errorBox: $('#error-box'),
  manualToggle: $('#manual-toggle'),
  manualPanel: $('#manual-panel'),
  manualText: $('#manual-text'),
  manualSubmit: $('#manual-submit'),
  settingsToggle: $('#settings-toggle'),
  settingsPanel: $('#settings-panel'),
  relayInput: $('#relay-input'),
  useRelay: $('#use-relay'),
  useProxies: $('#use-proxies'),
  settingsSave: $('#settings-save'),
  routesList: $('#routes-list'),
  demoBtn: $('#demo-load'),
  toast: $('#toast'),
};

const player = new StoryPlayer({
  root: els.player,
  mediaEl: els.media,
  railEl: els.rail,
  metaEl: els.meta,
  onIndexChange: updateActionButtons,
});

let lastItems = [];

function setStatus(text, tone = '') {
  els.status.textContent = text;
  els.status.dataset.tone = tone;
  els.status.hidden = !text;
}

function toast(msg, ms = 2800) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, ms);
}

function showResult(show) {
  els.result.hidden = !show;
}

function showError(message, hint) {
  els.errorBox.hidden = !message;
  if (message) {
    els.errorBox.innerHTML = `
      <div class="error-title">Could not load story</div>
      <div class="error-body">${escapeHtml(message)}</div>
      ${hint ? `<div class="error-hint">${escapeHtml(hint)}</div>` : ''}
    `;
  } else {
    els.errorBox.innerHTML = '';
  }
}

function updateActionButtons() {
  const item = player.currentItem();
  const has = Boolean(item);
  els.downloadBtn.disabled = !has;
  els.openBtn.disabled = !has;
}

function setPlatformBadge(platform, kind) {
  const map = {
    [PLATFORMS.INSTAGRAM]: { label: 'Instagram', cls: 'badge-ig' },
    [PLATFORMS.FACEBOOK]: { label: 'Facebook', cls: 'badge-fb' },
  };
  const info = map[platform] || { label: 'Unknown', cls: '' };
  els.platformBadge.textContent = kind ? `${info.label} · ${kind}` : info.label;
  els.platformBadge.className = `platform-badge ${info.cls}`;
  els.platformBadge.hidden = false;
}

async function runLookup(raw) {
  showError('');
  const parsed = parseUrl(raw);

  if (!parsed.normalized || parsed.platform === PLATFORMS.UNKNOWN) {
    showError(
      'That does not look like a Facebook or Instagram link.',
      'Example: https://www.instagram.com/stories/username/1234567890123456789'
    );
    showResult(false);
    return;
  }

  setPlatformBadge(parsed.platform, parsed.kind);
  showResult(true);
  els.player.hidden = true;
  setStatus('Resolving…', 'busy');

  let outcome;
  if (parsed.platform === PLATFORMS.INSTAGRAM) {
    outcome = await resolveInstagram(parsed);
  } else {
    outcome = await resolveFacebook(parsed);
  }

  if (!outcome.ok) {
    setStatus('');
    els.player.hidden = true;
    showError(outcome.error || 'Unknown error', outcome.hint);
    lastItems = [];
    updateActionButtons();
    return;
  }

  lastItems = outcome.items;
  els.hint.innerHTML = outcome.via
    ? `Resolved via <code>${escapeHtml(outcome.via)}</code> · ${outcome.items.length} segment(s)`
    : `${outcome.items.length} segment(s)`;
  setStatus('');
  els.player.hidden = false;
  player.setItems(lastItems);
  player.startKeyboard();
  updateActionButtons();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* events */
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  runLookup(els.input.value);
});

els.clearBtn.addEventListener('click', () => {
  els.input.value = '';
  els.input.focus();
  showResult(false);
  showError('');
});

els.pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      els.input.value = text.trim();
      els.input.focus();
      toast('Pasted from clipboard');
    }
  } catch {
    els.input.focus();
    toast('Clipboard blocked — paste manually (Ctrl+V)');
  }
});

els.downloadBtn.addEventListener('click', async () => {
  const item = player.currentItem();
  if (!item) return;
  setStatus('Saving…', 'busy');
  const result = await downloadMedia(item);
  setStatus('');
  if (result === 'saved') toast('Download started');
  else toast('Opened media tab — use browser Save if needed');
});

els.openBtn.addEventListener('click', () => {
  const item = player.currentItem();
  if (!item) return;
  window.open(item.url, '_blank', 'noopener,noreferrer');
});

els.manualToggle.addEventListener('click', () => {
  const open = els.manualPanel.hidden;
  els.manualPanel.hidden = !open;
  els.manualToggle.setAttribute('aria-expanded', String(open));
  if (open) els.manualText.focus();
});

els.manualSubmit.addEventListener('click', () => {
  const text = els.manualText.value;
  if (!text.trim()) {
    showError('Paste JSON or page source first.', 'Open the story/media URL in a new tab, copy the response or page source, paste here.');
    return;
  }
  showError('');
  const { items, message } = parseManualPayload(text);
  if (!items.length) {
    showError(message || 'Nothing found.', 'Look for URLs containing cdninstagram.com, fbcdn.net, or scontent.');
    return;
  }
  lastItems = items;
  showResult(true);
  els.player.hidden = false;
  els.platformBadge.hidden = false;
  els.platformBadge.textContent = 'Manual paste';
  els.platformBadge.className = 'platform-badge badge-manual';
  els.hint.textContent = `${items.length} segment(s) from pasted payload`;
  player.setItems(items);
  player.startKeyboard();
  updateActionButtons();
  setStatus('');
});

els.settingsToggle.addEventListener('click', () => {
  const open = els.settingsPanel.hidden;
  els.settingsPanel.hidden = !open;
  els.settingsToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    const s = loadSettings();
    els.relayInput.value = s.relay;
    els.useRelay.checked = s.useRelay;
    els.useProxies.checked = s.useProxies;
    renderRoutes();
  }
});

els.settingsSave.addEventListener('click', () => {
  saveSettings({
    relay: els.relayInput.value.trim(),
    useRelay: els.useRelay.checked,
    useProxies: els.useProxies.checked,
  });
  renderRoutes();
  toast('Settings saved in this browser');
});

function renderRoutes() {
  const rows = listRoutesSummary();
  els.routesList.innerHTML = rows
    .map(
      (r) =>
        `<li><span class="route-label">${escapeHtml(r.label)}</span><code>${escapeHtml(r.url.slice(0, 80))}${r.url.length > 80 ? '…' : ''}</code></li>`
    )
    .join('');
}

/* demo data — lets you verify player UI without hitting Meta */
const DEMO_ITEMS = [
  {
    type: 'image',
    url: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1080&q=80',
    username: 'demo',
    caption: 'Demo still — not from Instagram',
    id: 'demo1',
    source: 'demo',
  },
  {
    type: 'image',
    url: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=1080&q=80',
    username: 'demo',
    caption: 'Second demo frame',
    id: 'demo2',
    source: 'demo',
  },
  {
    type: 'video',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    username: 'demo',
    caption: 'Demo video segment',
    id: 'demo3',
    source: 'demo',
  },
];

els.demoBtn.addEventListener('click', () => {
  lastItems = DEMO_ITEMS;
  showResult(true);
  showError('');
  els.player.hidden = false;
  els.platformBadge.hidden = false;
  els.platformBadge.textContent = 'Demo · not live';
  els.platformBadge.className = 'platform-badge badge-manual';
  els.hint.textContent = 'Local demo segments (UI preview only)';
  player.setItems(DEMO_ITEMS);
  player.startKeyboard();
  updateActionButtons();
});

updateActionButtons();
