import { decodeStegFromBytes, formatTime, toDataUrl } from '/app/scripts/steg-core.js';

const state = {
  tracks: [],
  filtered: [],
  currentTrack: null,
  currentAudioUrl: null,
  shuffle: false,
};

const els = {
  serverLabel: document.getElementById('serverLabel'),
  artwork: document.getElementById('artwork'),
  title: document.getElementById('title'),
  subtitle: document.getElementById('subtitle'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  shuffleBtn: document.getElementById('shuffleBtn'),
  seek: document.getElementById('seek'),
  timeCurrent: document.getElementById('timeCurrent'),
  timeTotal: document.getElementById('timeTotal'),
  search: document.getElementById('search'),
  status: document.getElementById('status'),
  trackList: document.getElementById('trackList'),
  audio: document.getElementById('audio'),
  decodeCanvas: document.getElementById('decodeCanvas'),
};

function setStatus(message) {
  els.status.textContent = message || '';
}

function renderShuffleButton() {
  els.shuffleBtn.textContent = state.shuffle ? 'Shuffle On' : 'Shuffle Off';
  els.shuffleBtn.setAttribute('aria-pressed', String(state.shuffle));
  setStatus(state.shuffle ? 'Shuffle is on.' : 'Shuffle is off.');
}

function getNextTrackId() {
  if (!state.filtered.length) return null;
  if (state.shuffle) {
    const pool = state.filtered.filter((track) => track.id !== state.currentTrack?.id);
    const pickFrom = pool.length ? pool : state.filtered;
    return pickFrom[Math.floor(Math.random() * pickFrom.length)]?.id || null;
  }
  const index = state.filtered.findIndex((track) => track.id === state.currentTrack?.id);
  if (index === -1) return state.filtered[0]?.id || null;
  return state.filtered[(index + 1) % state.filtered.length]?.id || null;
}

function renderList() {
  const query = els.search.value.trim().toLowerCase();
  state.filtered = state.tracks.filter((track) => {
    const haystack = [track.title, track.artist, track.album].join(' ').toLowerCase();
    return !query || haystack.includes(query);
  });

  if (!state.filtered.length) {
    els.trackList.innerHTML = '<div class="muted">No tracks match this search.</div>';
    return;
  }

  els.trackList.innerHTML = state.filtered.map((track) => `
    <button class="track ${track.id === state.currentTrack?.id ? 'active' : ''}" data-track-id="${track.id}">
      <img src="${track.artworkUrl}" alt="${track.title}" onerror="this.src=''; this.classList.add('missing-art'); this.closest('.track')?.classList.add('missing-art');">
      <div>
        <div class="track-title">${escapeHtml(track.title || 'Untitled')}</div>
        <div class="track-sub">${escapeHtml(track.artist || 'Unknown artist')}</div>
        <div class="track-meta">${escapeHtml(track.album || 'Unknown album')}</div>
      </div>
      <div class="track-pill">PNG</div>
    </button>
  `).join('');

  els.trackList.querySelectorAll('[data-track-id]').forEach((button) => {
    button.addEventListener('click', () => loadTrack(button.dataset.trackId));
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function fetchLibrary() {
  const response = await fetch('/api/library', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the remote library.');
  const data = await response.json();
  state.tracks = Array.isArray(data.tracks) ? data.tracks : [];
  renderList();
}

async function loadTrack(trackId) {
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) return;
  state.currentTrack = track;
  renderList();
  els.title.textContent = track.title || 'Untitled';
  els.subtitle.textContent = `${track.artist || 'Unknown artist'} • ${track.album || 'Unknown album'}`;
  els.artwork.src = track.artworkUrl;
  els.artwork.onerror = () => {
    els.artwork.removeAttribute('src');
    setStatus('Artwork preview unavailable for this track, but audio decode may still work.');
  };
  els.downloadBtn.href = track.downloadUrl || track.stegUrl;
  els.downloadBtn.classList.remove('disabled');
  els.playPauseBtn.disabled = true;
  els.seek.disabled = true;
  setStatus(`Decoding ${track.title || track.id}...`);

  try {
    const response = await fetch(track.stegUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not fetch the steg PNG.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = await decodeStegFromBytes(bytes, els.decodeCanvas);
    if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
    state.currentAudioUrl = toDataUrl(decoded.audioBytes, 'audio/mpeg');
    els.audio.src = state.currentAudioUrl;
    els.audio.currentTime = 0;
    els.playPauseBtn.disabled = false;
    els.seek.disabled = false;
    await els.audio.play().catch(() => {});
    setStatus(`Decoded ${formatTime(track.durationSeconds || 0)} from steg PNG.`);
  } catch (error) {
    const message = error?.message || String(error);
    if (/Web Crypto SHA-256/i.test(message)) {
      setStatus('This phone browser cannot decode these tracks here yet. Try Chrome or Safari, or use HTTPS/Tailscale for a secure context.');
    } else {
      setStatus(message);
    }
  }
}

els.search.addEventListener('input', renderList);
els.shuffleBtn.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  renderShuffleButton();
});
els.playPauseBtn.addEventListener('click', async () => {
  if (!els.audio.src) return;
  if (els.audio.paused) await els.audio.play();
  else els.audio.pause();
});
els.seek.addEventListener('input', () => {
  if (els.audio.duration) els.audio.currentTime = (Number(els.seek.value) / 1000) * els.audio.duration;
});
els.audio.addEventListener('play', () => { els.playPauseBtn.textContent = 'Pause'; });
els.audio.addEventListener('pause', () => { els.playPauseBtn.textContent = 'Play'; });
els.audio.addEventListener('timeupdate', () => {
  els.timeCurrent.textContent = formatTime(els.audio.currentTime);
  els.timeTotal.textContent = formatTime(els.audio.duration);
  if (els.audio.duration) els.seek.value = String(Math.round((els.audio.currentTime / els.audio.duration) * 1000));
});
els.audio.addEventListener('ended', async () => {
  const nextId = getNextTrackId();
  if (nextId) await loadTrack(nextId);
});

(async function init() {
  renderShuffleButton();
  els.serverLabel.textContent = `${location.origin}/remote-player/`;
  try {
    await fetchLibrary();
    if (state.tracks[0]) await loadTrack(state.tracks[0].id);
  } catch (error) {
    setStatus(error.message || String(error));
  }
})();
