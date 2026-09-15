/**
 * Instagram-style story player.
 * Segmented progress, tap zones, pause/mute, fullscreen, keyboard.
 */
export class StoryPlayer {
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
    this.paused = false;
    this.muted = true;
    this._imageStart = 0;
    this._imageElapsed = 0;
    this._bound = false;

    this._onKey = this._onKey.bind(this);
    this._onZonePrev = () => this.prev();
    this._onZoneNext = () => this.next();
    this._onPlay = () => this.togglePause();
    this._onMute = () => this.toggleMute();
    this._onFs = () => this.toggleFullscreen();
  }

  setItems(items) {
    this.teardown();
    this.items = (items || []).filter((i) => i && i.url);
    this.index = 0;
    this.paused = false;
    this._imageElapsed = 0;
    this._bindChrome();
    if (this.items.length) this.show(0);
    else this.renderEmpty();
  }

  teardown() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.videoCleanup) {
      this.videoCleanup();
      this.videoCleanup = null;
    }
  }

  stop() {
    this.teardown();
    this._unbindChrome();
    document.removeEventListener('keydown', this._onKey);
  }

  startKeyboard() {
    document.addEventListener('keydown', this._onKey);
    this._bindChrome();
  }

  _bindChrome() {
    if (this._bound) return;
    const prev = document.getElementById('zone-prev');
    const next = document.getElementById('zone-next');
    const play = document.getElementById('player-play');
    const mute = document.getElementById('player-mute');
    const fs = document.getElementById('player-fullscreen');
    if (prev) prev.addEventListener('click', this._onZonePrev);
    if (next) next.addEventListener('click', this._onZoneNext);
    if (play) play.addEventListener('click', this._onPlay);
    if (mute) mute.addEventListener('click', this._onMute);
    if (fs) fs.addEventListener('click', this._onFs);
    this._bound = true;
  }

  _unbindChrome() {
    const prev = document.getElementById('zone-prev');
    const next = document.getElementById('zone-next');
    const play = document.getElementById('player-play');
    const mute = document.getElementById('player-mute');
    const fs = document.getElementById('player-fullscreen');
    if (prev) prev.removeEventListener('click', this._onZonePrev);
    if (next) next.removeEventListener('click', this._onZoneNext);
    if (play) play.removeEventListener('click', this._onPlay);
    if (mute) mute.removeEventListener('click', this._onMute);
    if (fs) fs.removeEventListener('click', this._onFs);
    this._bound = false;
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
    } else if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      this.togglePause();
    } else if (e.key === 'm') {
      e.preventDefault();
      this.toggleMute();
    } else if (e.key === 'f') {
      e.preventDefault();
      this.toggleFullscreen();
    } else if (e.key === 'Escape') {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else this.pause();
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

  togglePause() {
    this.paused ? this.resume() : this.pause();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.root.classList.add('is-paused');
    this._syncPlayBtn();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this._imageElapsed = Math.min(this.durationMs, Date.now() - this._imageStart);
    }
    const video = this.mediaEl.querySelector('video');
    if (video) video.pause();
    this._freezeRail();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.root.classList.remove('is-paused');
    this._syncPlayBtn();
    const item = this.items[this.index];
    const video = this.mediaEl.querySelector('video');
    if (video) {
      video.play().catch(() => {});
      return;
    }
    if (item && item.type !== 'video') {
      const remaining = Math.max(0, this.durationMs - this._imageElapsed);
      this._imageStart = Date.now() - this._imageElapsed;
      this.timer = setTimeout(() => this.next(), remaining);
      this._resumeRail(remaining);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    const video = this.mediaEl.querySelector('video');
    if (video) video.muted = this.muted;
    this._syncMuteBtn();
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await this.root.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
  }

  _syncPlayBtn() {
    const btn = document.getElementById('player-play');
    if (!btn) return;
    const pauseIcon = btn.querySelector('.icon-pause');
    const playIcon = btn.querySelector('.icon-play');
    if (pauseIcon) pauseIcon.hidden = this.paused;
    if (playIcon) playIcon.hidden = !this.paused;
    btn.setAttribute('aria-label', this.paused ? 'Play' : 'Pause');
  }

  _syncMuteBtn() {
    const btn = document.getElementById('player-mute');
    if (!btn) return;
    const mutedIcon = btn.querySelector('.icon-muted');
    const unmutedIcon = btn.querySelector('.icon-unmuted');
    if (mutedIcon) mutedIcon.hidden = !this.muted;
    if (unmutedIcon) unmutedIcon.hidden = this.muted;
    btn.setAttribute('aria-label', this.muted ? 'Unmute' : 'Mute');
    btn.hidden = !(this.items[this.index] && this.items[this.index].type === 'video');
  }

  show(i) {
    if (!this.items.length) return;
    this.index = Math.max(0, Math.min(i, this.items.length - 1));
    const item = this.items[this.index];

    this.teardown();
    this.paused = false;
    this.root.classList.remove('is-paused');
    this._imageElapsed = 0;
    this._syncPlayBtn();

    this.renderRail();
    this.renderMeta(item);
    this.mediaEl.innerHTML = '';
    this.mediaEl.classList.remove('is-video', 'is-image');

    if (item.type === 'video') {
      this.mediaEl.classList.add('is-video');
      const video = document.createElement('video');
      video.className = 'player-video';
      video.src = item.url;
      video.playsInline = true;
      video.muted = this.muted;
      video.autoplay = true;
      video.preload = 'auto';
      video.setAttribute('playsinline', '');
      this.mediaEl.appendChild(video);

      const onEnded = () => this.next();
      const onTime = () => {
        this.updateVideoRail(video);
        this._updateTime(video.currentTime, video.duration);
      };
      video.addEventListener('ended', onEnded);
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('loadedmetadata', onTime);
      video.play().catch(() => {
        this.paused = true;
        this._syncPlayBtn();
      });

      this.videoCleanup = () => {
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('timeupdate', onTime);
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
      this._syncMuteBtn();
    } else {
      this.mediaEl.classList.add('is-image');
      const img = document.createElement('img');
      img.className = 'player-image';
      img.src = item.url;
      img.alt = item.caption || 'Story media';
      img.referrerPolicy = 'no-referrer';
      img.draggable = false;
      this.mediaEl.appendChild(img);

      this._imageStart = Date.now();
      this.timer = setTimeout(() => this.next(), this.durationMs);
      this.animateImageRail();
      this._updateTime(0, this.durationMs / 1000);
      this._syncMuteBtn();
    }

    this.root.dataset.index = String(this.index);
    this.onIndexChange(this.index, this.items.length);
  }

  _updateTime(current, duration) {
    const el = document.getElementById('player-time');
    if (!el) return;
    if (!duration || !isFinite(duration)) {
      el.textContent = fmtTime(current || 0);
      return;
    }
    el.textContent = `${fmtTime(current)} / ${fmtTime(duration)}`;
  }

  updateVideoRail(video) {
    if (this.paused) return;
    const seg = this.railEl.querySelectorAll('.rail-seg-fill')[this.index];
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
    void seg.offsetWidth;
    if (!this.paused) {
      seg.style.transition = `transform ${this.durationMs}ms linear`;
      seg.style.transform = 'scaleX(1)';
    }
  }

  _freezeRail() {
    const seg = this.railEl.querySelectorAll('.rail-seg-fill')[this.index];
    if (!seg) return;
    const computed = getComputedStyle(seg).transform;
    seg.style.transition = 'none';
    seg.style.transform = computed;
  }

  _resumeRail(remainingMs) {
    const seg = this.railEl.querySelectorAll('.rail-seg-fill')[this.index];
    if (!seg) return;
    seg.style.transition = 'none';
    void seg.offsetWidth;
    seg.style.transition = `transform ${remainingMs}ms linear`;
    seg.style.transform = 'scaleX(1)';
  }

  renderRail() {
    if (!this.items.length) {
      this.railEl.innerHTML = '';
      return;
    }
    this.railEl.innerHTML = this.items
      .map((_, i) => {
        const fill = i < this.index ? 1 : 0;
        return `<div class="rail-seg"><div class="rail-seg-fill" style="transform:scaleX(${fill})"></div></div>`;
      })
      .join('');
  }

  renderMeta(item) {
    const handle = item.username || '';
    const displayName = item.authorName || (handle ? `@${handle}` : '');
    const platform = item.platform || '';
    const when = item.takenAt
      ? new Date(item.takenAt * (item.takenAt < 1e12 ? 1000 : 1)).toLocaleString()
      : '';
    const cap = item.caption ? `<p class="player-caption">${escapeText(item.caption)}</p>` : '';
    const initial = (handle || displayName || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?';

    const avatar = `<span class="player-avatar" aria-hidden="true">${escapeText(initial)}</span>`;
    const name = displayName || handle || 'Unknown';
    const handleLine =
      handle && displayName && displayName !== `@${handle}`
        ? `<span class="player-author-handle">@${escapeText(handle)}</span>`
        : '';

    this.metaEl.innerHTML = `
      <div class="player-meta-row">
        <span class="player-author">
          ${avatar}
          <span class="player-author-text">
            <span class="player-author-name">${escapeText(name)}</span>
            ${handleLine}
          </span>
        </span>
        <span class="player-meta-side">
          ${platform ? `<span class="player-platform">${escapeText(platform)}</span>` : ''}
          <span class="player-count">${this.index + 1}/${this.items.length}</span>
        </span>
      </div>
      ${when ? `<div class="player-when">${escapeText(when)}</div>` : ''}
      ${cap}
    `;
  }

  renderEmpty() {
    this.mediaEl.innerHTML = `<div class="player-empty">No media to show</div>`;
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

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function downloadMedia(item) {
  if (!item || !item.url) return;

  const filename = buildFilename(item);
  const targetUrl = item.downloadUrl || item.url;

  try {
    const res = await fetch(targetUrl, { mode: 'cors', credentials: 'omit' });
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
    if (targetUrl !== item.url) {
      try {
        const res2 = await fetch(item.url, { mode: 'cors', credentials: 'omit' });
        if (res2.ok) {
          const blob2 = await res2.blob();
          const objectUrl2 = URL.createObjectURL(blob2);
          const a2 = document.createElement('a');
          a2.href = objectUrl2;
          a2.download = filename;
          document.body.appendChild(a2);
          a2.click();
          a2.remove();
          setTimeout(() => URL.revokeObjectURL(objectUrl2), 4000);
          return 'saved';
        }
      } catch {
        /* open tab */
      }
    }
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
