import { parseUrl, parseManualPayload, PLATFORMS } from './parser.js';
import { resolveInstagram } from './platforms/instagram.js';
import { resolveFacebook } from './platforms/facebook.js';
import { StoryPlayer, downloadMedia } from './player.js';

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  form: $('#lookup-form'),
  input: $('#url-input'),
  clearBtn: $('#clear-input'),
  pasteBtn: $('#paste-clip'),
  submitBtn: $('#submit-btn'),
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
let busy = false;

function setStatus(text, tone = '') {
  els.status.textContent = text;
  els.status.dataset.tone = tone;
  els.status.hidden = !text;
}

function setBusy(on) {
  busy = on;
  els.submitBtn.disabled = on;
  const label = els.submitBtn.querySelector('.btn-label');
  if (label) label.textContent = on ? 'Loading…' : 'View story';
  else els.submitBtn.textContent = on ? 'Loading…' : 'View story';
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
  const info = map[platform] || { label: 'Media', cls: '' };
  els.platformBadge.textContent = kind ? `${info.label} · ${kind}` : info.label;
  els.platformBadge.className = `platform-badge ${info.cls}`;
  els.platformBadge.hidden = false;
}

function applyItems(items, meta = {}) {
  lastItems = items;
  showResult(true);
  els.player.hidden = false;
  if (meta.badge) {
    els.platformBadge.hidden = false;
    els.platformBadge.textContent = meta.badge;
    els.platformBadge.className = `platform-badge ${meta.badgeCls || 'badge-manual'}`;
  }
  els.hint.innerHTML = meta.hint || `${items.length} segment(s)`;
  player.setItems(items);
  player.startKeyboard();
  updateActionButtons();
}

async function runLookup(raw) {
  if (busy) return;
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
  setStatus('Loading story…', 'busy');
  setBusy(true);

  try {
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

    setStatus('');
    applyItems(outcome.items, {
      hint: outcome.via
        ? `${outcome.items.length} segment(s)`
        : `${outcome.items.length} segment(s)`,
    });
  } finally {
    setBusy(false);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
      toast('Pasted');
    }
  } catch {
    els.input.focus();
    toast('Clipboard blocked — paste manually');
  }
});

els.downloadBtn.addEventListener('click', async () => {
  const item = player.currentItem();
  if (!item) return;
  setStatus('Saving…', 'busy');
  const result = await downloadMedia(item);
  setStatus('');
  if (result === 'saved') toast('Download started');
  else toast('Opened media — use browser Save if needed');
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
  els.manualToggle.textContent = open ? 'Hide paste box' : 'Open paste box';
  if (open) els.manualText.focus();
});

els.manualSubmit.addEventListener('click', () => {
  const text = els.manualText.value;
  if (!text.trim()) {
    showError('Paste JSON or page source first.', 'Open the story/media URL in a new tab, copy the response or page source.');
    return;
  }
  showError('');
  const { items, message } = parseManualPayload(text);
  if (!items.length) {
    showError(message || 'Nothing found.', 'Look for URLs containing cdninstagram.com, fbcdn.net, or scontent.');
    return;
  }
  applyItems(items, { badge: 'Pasted media', badgeCls: 'badge-manual' });
  setStatus('');
  document.getElementById('result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

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
  showError('');
  applyItems(DEMO_ITEMS, { badge: 'Demo', badgeCls: 'badge-manual', hint: 'Preview only — not live media' });
});

updateActionButtons();

// Prefill from ?url=
try {
  const q = new URLSearchParams(location.search).get('url');
  if (q) {
    els.input.value = q;
    runLookup(q);
  }
} catch {
  /* ignore */
}
