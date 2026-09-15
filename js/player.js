/**
 * Story segment player: Instagram-style progress rail, autoplay, keyboard.
 */
export class StoryPlayer {
  /**
   * @param {{
   *   root: HTMLElement,
   *   mediaEl: HTMLElement,
   *   railEl: HTMLElement,
   *   metaEl: HTMLElement,
   *   onIndexChange?: (i: number, total: number) => void
   * }} els
   */
  constructor(els) {
    this.root = els.root;
    this.mediaEl = els.mediaEl;
    this.railEl = els.railEl;
    this.metaEl = els.metaEl;
    this.onIndexChange = els.onIndexChange || (() => {});
    this.items = [];
    this.index = 0;
    this.timer = null;
    this.videoCleanup = null;
    this.durationMs = 5000;
    this._onKey = this._onKey.bind(this);
    this._onResize = null;
  }

  setItems(items) {
    this.stop();
    this.items = (items || []).filter((i) => i && i.url);
    this.index = 0;
    this.renderRail();
    if (this.items.length) this.show(0);
    else this.renderEmpty();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.videoCleanup) {
      this.videoCleanup();
      this.videoCleanup = null;
    }
    document.removeEventListener('keydown', this._onKey);
  }

  startKeyboard() {
    document.addEventListener('keydown', this._onKey);
  }

  _onKey(e) {
    if (!this.items.length) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
    } else if (e.key === 'Escape') {
      this.stop();
    }
  }

  next() {
    if (this.index < this.items.length - 1) this.show(this.index + 1);
    else this.show(0);
  }

  prev() {
    if (this.index > 0) this.show(this.index - 1);
    else this.show(this.items.length - 1);
  }

  show(i) {
    if (!this.items.length) return;
    this.index = Math.max(0, Math.min(i, this.items.length - 1));
    const item = this.items[this.index];

    if (this.timer) clearTimeout(this.timer);
    if (this.videoCleanup) {
      this.videoCleanup();
      this.videoCleanup = null;
    }

    this.renderRail();
    this.renderMeta(item);
    this.mediaEl.innerHTML = '';

    if (item.type === 'video') {
      const video = document.createElement('video');
      video.className = 'player-video';
      video.src = item.url;
      video.controls = true;
      video.playsInline = true;
      video.muted = true; // autoplay policy
      video.autoplay = true;
      video.preload = 'metadata';
      this.mediaEl.appendChild(video);

      const onEnded = () => this.next();
      const onTime = () => this.updateVideoRail(video);
      video.addEventListener('ended', onEnded);
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('loadedmetadata', onTime);
      video.play().catch(() => {
        /* user gesture needed — controls remain */
      });

      this.videoCleanup = () => {
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('timeupdate', onTime);
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    } else {
      const img = document.createElement('img');
      img.className = 'player-image';
      img.src = item.url;
      img.alt = item.caption || 'Story media';
      img.referrerPolicy = 'no-referrer';
      this.mediaEl.appendChild(img);

      this.timer = setTimeout(() => this.next(), this.durationMs);
      this.animateImageRail();
    }

    this.onIndexChange(this.index, this.items.length);
  }

  updateVideoRail(video) {
    const segments = this.railEl.querySelectorAll('.rail-seg-fill');
    const seg = segments[this.index];
    if (!seg) return;
    const d = video.duration;
    if (!d || !isFinite(d)) {
      seg.style.transform = 'scaleX(1)';
      return;
    }
    const p = Math.min(1, video.currentTime / d);
    seg.style.transform = `scaleX(${p})`;
  }

  animateImageRail() {
    const seg = this.railEl.querySelectorAll('.rail-seg-fill')[this.index];
    if (!seg) return;
    seg.style.transition = 'none';
    seg.style.transform = 'scaleX(0)';
    // reflow
    void seg.offsetWidth;
    seg.style.transition = `transform ${this.durationMs}ms linear`;
    seg.style.transform = 'scaleX(1)';
  }

  renderRail() {
    if (!this.items.length) {
      this.railEl.innerHTML = '';
      return;
    }
    this.railEl.innerHTML = this.items
      .map(
        (_, i) =>
          `<div class="rail-seg" aria-hidden="true"><div class="rail-seg-fill" style="transform:scaleX(${i < this.index ? 1 : 0})"></div></div>`
      )
      .join('');
  }

  renderMeta(item) {
    const handle = item.username || '';
    const displayName = item.authorName || (handle ? `@${handle}` : '');
    const platform = item.platform || item.source || '';
    const when = item.takenAt
      ? new Date(item.takenAt * (item.takenAt < 1e12 ? 1000 : 1)).toLocaleString()
      : '';
    const cap = item.caption
      ? `<p class="player-caption">${escapeText(item.caption)}</p>`
      : '';

    const initial = (handle || displayName || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?';
    const avatar = handle
      ? `<span class="player-avatar" aria-hidden="true">${escapeText(initial)}</span>`
      : `<span class="player-avatar player-avatar-plain" aria-hidden="true"></span>`;

    const authorBlock = displayName || handle
      ? `<span class="player-author">
           ${avatar}
           <span class="player-author-text">
             <span class="player-author-name">${escapeText(displayName || handle)}</span>
             ${handle && displayName && displayName !== `@${handle}` ? `<span class="player-author-handle">@${escapeText(handle)}</span>` : ''}
           </span>
         </span>`
      : `<span class="player-author">
           <span class="player-avatar player-avatar-plain" aria-hidden="true"></span>
           <span class="player-author-text"><span class="player-author-name">Unknown author</span></span>
         </span>`;

    this.metaEl.innerHTML = `
      <div class="player-meta-row">
        ${authorBlock}
        <span class="player-meta-side">
          ${platform ? `<span class="player-platform">${escapeText(platform)}</span>` : ''}
          <span class="player-count">${this.index + 1} / ${this.items.length}</span>
        </span>
      </div>
      ${when ? `<div class="player-when">${escapeText(when)}</div>` : ''}
      ${cap}
    `;
  }

  renderEmpty() {
    this.mediaEl.innerHTML = `<div class="player-empty">No segments to show</div>`;
    this.metaEl.innerHTML = '';
    this.railEl.innerHTML = '';
  }

  currentIndex() {
    return this.index;
  }

  currentItem() {
    return this.items[this.index] || null;
  }
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Trigger a browser download. Works best when CDN sends CORS;
 * otherwise opens in a new tab so the browser save dialog can still help.
 */
export async function downloadMedia(item) {
  if (!item || !item.url) return;

  const filename = buildFilename(item);

  try {
    const res = await fetch(item.url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    return 'saved';
  } catch {
    // fallback: open media so user can save manually
    window.open(item.url, '_blank', 'noopener,noreferrer');
    return 'opened';
  }
}

function buildFilename(item) {
  const user = (item.username || 'story').replace(/[^\w.-]+/g, '_');
  const id = item.id || 'media';
  const ext = item.type === 'video' ? 'mp4' : 'jpg';
  return `${user}_${id}.${ext}`;
}
