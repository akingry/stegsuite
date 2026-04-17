import {
  W,
  H,
  drawCoverToCanvas,
  encodeSteg,
  decodeStegFromBytes,
  parseId3Tags,
  parseCsvList,
  slugify,
  formatTime,
  humanBytes,
  toDataUrl,
  sha256,
  hex,
} from './steg-core.js';
import { loadLibrary, applyFilters, collectGenres, libraryStats, upsertTrack } from './library.js';

const state = {
  tracks: [],
  playlists: [],
  filteredTracks: [],
  currentTrackId: null,
  currentAudioUrl: null,
  currentImageUrl: null,
  saveHelperUrl: globalThis.stegsuiteDesktop?.saveHelperUrl || 'http://127.0.0.1:43123',
  lookupMatches: [],
  selectedLookupIndex: 0,
  importImageValid: false,
  importMp3Valid: false,
  importImageBitmap: null,
  importImageName: '',
  deleteMode: false,
};

const els = {
  gallery: document.getElementById('gallery'),
  searchInput: document.getElementById('searchInput'),
  sortSelect: document.getElementById('sortSelect'),
  genreFilter: document.getElementById('genreFilter'),
  playlistFilter: document.getElementById('playlistFilter'),
  favoritesOnly: document.getElementById('favoritesOnly'),
  libraryStats: document.getElementById('libraryStats'),
  importForm: document.getElementById('importForm'),
  mp3Input: document.getElementById('mp3Input'),
  imageInput: document.getElementById('imageInput'),
  importPreview: document.getElementById('importPreview'),
  importStatus: document.getElementById('importStatus'),
  resetImportBtn: document.getElementById('resetImportBtn'),
  generateBtn: document.getElementById('generateBtn'),
  autofillBtn: document.getElementById('autofillBtn'),
  lookupMetadataBtn: document.getElementById('lookupMetadataBtn'),
  lookupResults: document.getElementById('lookupResults'),
  cropXSlider: document.getElementById('cropXSlider'),
  cropYSlider: document.getElementById('cropYSlider'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  toggleDeleteModeBtn: document.getElementById('toggleDeleteModeBtn'),
  nowPlayingTitle: document.getElementById('nowPlayingTitle'),
  nowPlayingSubtitle: document.getElementById('nowPlayingSubtitle'),
  favoriteBtn: document.getElementById('favoriteBtn'),
  artworkCanvas: document.getElementById('artworkCanvas'),
  audio: document.getElementById('audio'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  stopBtn: document.getElementById('stopBtn'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  seekSlider: document.getElementById('seekSlider'),
  timeCurrent: document.getElementById('timeCurrent'),
  timeTotal: document.getElementById('timeTotal'),
  autoplayNext: document.getElementById('autoplayNext'),
  playerStatus: document.getElementById('playerStatus'),
  infoAlbum: document.getElementById('infoAlbum'),
  infoGenre: document.getElementById('infoGenre'),
  infoDuration: document.getElementById('infoDuration'),
  infoYear: document.getElementById('infoYear'),
  infoLsb: document.getElementById('infoLsb'),
  infoTrailing: document.getElementById('infoTrailing'),
  titleInput: document.getElementById('titleInput'),
  artistInput: document.getElementById('artistInput'),
  albumInput: document.getElementById('albumInput'),
  albumArtistInput: document.getElementById('albumArtistInput'),
  genreInput: document.getElementById('genreInput'),
  yearInput: document.getElementById('yearInput'),
  trackInput: document.getElementById('trackInput'),
  tagsInput: document.getElementById('tagsInput'),
};

function setStatus(el, message, kind = '') {
  if (!message || kind === 'ok') {
    clearStatus(el);
    return;
  }
  el.className = `status${kind ? ` ${kind}` : ''}`;
  el.textContent = message;
  el.classList.remove('hidden');
}
function clearStatus(el) {
  el.textContent = '';
  el.className = 'status hidden';
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function setLookupMessage(message) {
  els.lookupResults.innerHTML = `<div class="lookup-message">${escapeHtml(message)}</div>`;
}
function updateGenerateState() {
  const ready = state.importImageValid
    && state.importMp3Valid
    && els.titleInput.value.trim()
    && els.artistInput.value.trim();
  els.generateBtn.disabled = !ready;
}
async function validateImageSource(source) {
  const bitmap = await createImageBitmap(source);
  if (bitmap.width < 1920 || bitmap.height < 1080) {
    bitmap.close?.();
    throw new Error('Image must be at least 1920 × 1080.');
  }
  return bitmap;
}
function renderImportCropPreview() {
  const bmp = state.importImageBitmap;
  const ctx = els.importPreview.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!bmp) {
    state.importImageValid = false;
    updateGenerateState();
    return;
  }

  const scale = Math.max(W / bmp.width, H / bmp.height);
  const sourceWidth = W / scale;
  const sourceHeight = H / scale;
  const maxX = Math.max(0, bmp.width - sourceWidth);
  const maxY = Math.max(0, bmp.height - sourceHeight);
  const offsetX = maxX * (Number(els.cropXSlider.value) / 1000);
  const offsetY = maxY * (Number(els.cropYSlider.value) / 1000);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, offsetX, offsetY, sourceWidth, sourceHeight, 0, 0, W, H);
  state.importImageValid = true;
  updateGenerateState();
}
async function loadPreviewImage(fileOrBlob, name = '') {
  if (state.importImageBitmap) state.importImageBitmap.close?.();
  state.importImageBitmap = await validateImageSource(fileOrBlob);
  state.importImageName = name;
  els.cropXSlider.value = '500';
  els.cropYSlider.value = '500';
  renderImportCropPreview();
  return { width: state.importImageBitmap.width, height: state.importImageBitmap.height };
}
function summarizeRelease(release) {
  if (!release) {
    return {
      title: '',
      mbid: '',
      year: '',
      date: '',
      country: '',
      status: '',
      packaging: '',
      disambiguation: '',
      primaryType: '',
      secondaryTypes: [],
    };
  }
  return {
    title: release.title || '',
    mbid: release.id || '',
    year: (release.date || '').slice(0, 4) || '',
    date: release.date || '',
    country: release.country || '',
    status: release.status || '',
    packaging: release.packaging || '',
    disambiguation: release.disambiguation || '',
    primaryType: release['release-group']?.['primary-type'] || '',
    secondaryTypes: release['release-group']?.['secondary-types'] || [],
  };
}
function pickBestRelease(item) {
  const releases = Array.isArray(item.releases) ? [...item.releases] : [];
  if (!releases.length) return null;
  releases.sort((a, b) => {
    const aDate = (a.date || '9999-99-99');
    const bDate = (b.date || '9999-99-99');
    const aPrimary = a['release-group']?.['primary-type'] || '';
    const bPrimary = b['release-group']?.['primary-type'] || '';
    const aScore = aPrimary === 'Album' ? 0 : aPrimary === 'Single' ? 1 : 2;
    const bScore = bPrimary === 'Album' ? 0 : bPrimary === 'Single' ? 1 : 2;
    const aPenalty = /remaster|deluxe|anniversary|reissue|stereo|mono/i.test(`${a.disambiguation || ''} ${a.title || ''}`) ? 1 : 0;
    const bPenalty = /remaster|deluxe|anniversary|reissue|stereo|mono/i.test(`${b.disambiguation || ''} ${b.title || ''}`) ? 1 : 0;
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    if (aPenalty !== bPenalty) return aPenalty - bPenalty;
    return aScore - bScore;
  });
  return releases[0];
}
function applyLookupMatch(index) {
  const match = state.lookupMatches[index];
  if (!match) return;
  state.selectedLookupIndex = index;
  els.titleInput.value = match.title || '';
  els.artistInput.value = match.artist || '';
  els.albumInput.value = match.releaseTitle || '';
  els.albumArtistInput.value = match.artist || '';
  if (match.year) els.yearInput.value = match.year;
  if (match.genre?.length) els.genreInput.value = match.genre.join(', ');
  if (match.tags?.length) els.tagsInput.value = match.tags.join(', ');
  renderLookupResults();
  updateGenerateState();
}
function renderLookupResults(message = '') {
  if (!state.lookupMatches.length) {
    setLookupMessage(message || 'No matches found.');
    return;
  }
  els.lookupResults.innerHTML = state.lookupMatches.map((item, index) => {
    const meta = [];
    if (item.releaseTitle) meta.push(`Release: ${escapeHtml(item.releaseTitle)}`);
    if (item.releaseDate) meta.push(`Release date: ${escapeHtml(item.releaseDate)}`);
    else if (item.year) meta.push(`Year: ${escapeHtml(item.year)}`);
    if (item.releaseCountry || item.releaseStatus) {
      meta.push([item.releaseCountry ? `Country: ${escapeHtml(item.releaseCountry)}` : '', item.releaseStatus ? `Status: ${escapeHtml(item.releaseStatus)}` : ''].filter(Boolean).join(' • '));
    }
    if (item.primaryType || item.secondaryTypes?.length) {
      meta.push(`Type: ${escapeHtml(item.primaryType || '')}${item.secondaryTypes?.length ? ` / ${escapeHtml(item.secondaryTypes.join(', '))}` : ''}`.trim());
    }
    if (item.releaseDisambiguation) meta.push(`Notes: ${escapeHtml(item.releaseDisambiguation)}`);
    if (item.genre?.length) meta.push(`Genres: ${escapeHtml(item.genre.join(', '))}`);
    if (item.tags?.length) meta.push(`Tags: ${escapeHtml(item.tags.join(', '))}`);

    return `
    <article class="lookup-card ${index === state.selectedLookupIndex ? 'active' : ''}" data-lookup-index="${index}">
      <div>
        <div class="lookup-card-title">${escapeHtml(item.title)}</div>
        <div class="lookup-card-sub">${escapeHtml(item.artist)}</div>
        <div class="lookup-card-meta-list">${meta.map((line) => `<div class="lookup-card-meta">${line}</div>`).join('')}</div>
      </div>
      <div class="lookup-card-actions">
        <button type="button" class="secondary" data-apply-lookup="${index}">Use this metadata</button>
      </div>
    </article>
  `;
  }).join('');

  if (message) {
    const note = document.createElement('div');
    note.className = 'lookup-message';
    note.textContent = message;
    els.lookupResults.prepend(note);
  }

  els.lookupResults.querySelectorAll('[data-apply-lookup]').forEach((button) => {
    button.addEventListener('click', () => applyLookupMatch(Number(button.dataset.applyLookup)));
  });
}
async function bytesFromFile(file) {
  return new Uint8Array(await file.arrayBuffer());
}
function getFilters() {
  return {
    search: els.searchInput.value.trim(),
    sort: els.sortSelect.value,
    genre: els.genreFilter.value,
    playlist: els.playlistFilter.value,
    favoritesOnly: els.favoritesOnly.checked,
  };
}
function renderFilterOptions() {
  const genres = collectGenres(state.tracks);
  els.genreFilter.innerHTML = '<option value="">All</option>' + genres.map((genre) => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('');
  els.playlistFilter.innerHTML = '<option value="">All tracks</option>' + state.playlists.map((playlist) => `<option value="${escapeHtml(playlist.id)}">${escapeHtml(playlist.name)}</option>`).join('');
}
function renderDeleteModeButton() {
  if (!els.toggleDeleteModeBtn) return;
  els.toggleDeleteModeBtn.textContent = state.deleteMode ? 'Done deleting' : 'Delete mode';
  els.toggleDeleteModeBtn.classList.toggle('danger-mode', state.deleteMode);
}
async function deleteTrack(trackId, deleteFile = false) {
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) return;
  const response = await fetch(`${state.saveHelperUrl}/delete-track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: trackId, deleteFile }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || 'Could not delete the steg track.');
  }

  state.tracks = state.tracks.filter((item) => item.id !== trackId);
  if (state.currentTrackId === trackId) {
    els.audio.pause();
    els.audio.removeAttribute('src');
    els.audio.load();
    state.currentTrackId = null;
    els.nowPlayingTitle.textContent = 'Nothing selected';
    els.nowPlayingSubtitle.textContent = 'Click a steg image tile to decode and play.';
    els.playPauseBtn.disabled = true;
    els.stopBtn.disabled = true;
    els.prevBtn.disabled = true;
    els.nextBtn.disabled = true;
    els.seekSlider.disabled = true;
    els.favoriteBtn.disabled = true;
    els.timeCurrent.textContent = '0:00';
    els.timeTotal.textContent = '0:00';
    els.seekSlider.value = '0';
  }
  renderFilterOptions();
  renderGallery();
}
function renderGallery() {
  state.filteredTracks = applyFilters(state.tracks, getFilters(), state.playlists);
  els.libraryStats.textContent = `${libraryStats(state.filteredTracks)} shown`;
  if (!state.filteredTracks.length) {
    els.gallery.innerHTML = '<div class="empty-state">No tracks match the current filters yet.</div>';
    return;
  }
  els.gallery.innerHTML = state.filteredTracks.map((track) => `
    <article class="tile ${track.id === state.currentTrackId ? 'active' : ''}" data-track-id="${escapeHtml(track.id)}">
      <button type="button" class="tile-delete ${state.deleteMode ? '' : 'hidden'}" data-delete-track="${escapeHtml(track.id)}">Delete</button>
      <img src="../${escapeHtml(track.stegFile)}" alt="${escapeHtml(track.title)}" />
      <div class="tile-body">
        <div class="tile-title">${escapeHtml(track.title || 'Untitled')}</div>
        <div class="tile-sub">${escapeHtml(track.artist || 'Unknown artist')}</div>
        <div class="tile-meta">${escapeHtml(track.album || 'Unknown album')} • ${escapeHtml((track.genre || []).join(', ') || 'No genre')}</div>
      </div>
    </article>
  `).join('');
  els.gallery.querySelectorAll('[data-track-id]').forEach((node) => {
    node.addEventListener('click', (event) => {
      if (event.target.closest('[data-delete-track]')) return;
      playTrack(node.dataset.trackId);
    });
  });
  els.gallery.querySelectorAll('[data-delete-track]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const trackId = button.dataset.deleteTrack;
      const deleteFile = window.confirm('Delete the steg image file from the stegmp3 folder too? Click OK to delete the steg file, or Cancel to only remove it from the library screen.');
      try {
        await deleteTrack(trackId, deleteFile);
      } catch (error) {
        setStatus(els.playerStatus, error.message || String(error), 'err');
      }
    });
  });
  renderDeleteModeButton();
}
async function playTrack(trackId) {
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) return;
  state.currentTrackId = track.id;
  renderGallery();
  setStatus(els.playerStatus, `Loading ${track.title || track.id}...`);
  try {
    const response = await fetch(`../${track.stegFile}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not fetch ${track.stegFile}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = await decodeStegFromBytes(bytes, els.artworkCanvas);
    if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
    state.currentAudioUrl = toDataUrl(decoded.audioBytes, 'audio/mpeg');
    els.audio.src = state.currentAudioUrl;
    els.audio.currentTime = 0;
    await els.audio.play().catch(() => {});
    els.playPauseBtn.disabled = false;
    els.stopBtn.disabled = false;
    els.prevBtn.disabled = false;
    els.nextBtn.disabled = false;
    els.seekSlider.disabled = false;
    els.favoriteBtn.disabled = false;
    els.favoriteBtn.textContent = track.favorite ? '★ Favorited' : '☆ Favorite';
    els.nowPlayingTitle.textContent = track.title || 'Untitled';
    els.nowPlayingSubtitle.textContent = `${track.artist || 'Unknown artist'} • ${track.album || 'Unknown album'}`;
    els.infoAlbum.textContent = track.album || '—';
    els.infoGenre.textContent = (track.genre || []).join(', ') || '—';
    els.infoDuration.textContent = formatTime(track.durationSeconds || 0);
    els.infoYear.textContent = track.year || '—';
    els.infoLsb.textContent = humanBytes(decoded.lsbMp3Len);
    els.infoTrailing.textContent = humanBytes(decoded.trailLen);
    setStatus(els.playerStatus, `Decoded ${humanBytes(decoded.mp3Len)} from ${track.title || track.id}.`, 'ok');
  } catch (error) {
    setStatus(els.playerStatus, error.message || String(error), 'err');
  }
}
function getCurrentTrack() {
  return state.tracks.find((track) => track.id === state.currentTrackId) || null;
}
function stepTrack(direction) {
  if (!state.filteredTracks.length) return;
  const index = state.filteredTracks.findIndex((track) => track.id === state.currentTrackId);
  const nextIndex = index >= 0 ? (index + direction + state.filteredTracks.length) % state.filteredTracks.length : 0;
  playTrack(state.filteredTracks[nextIndex].id);
}
function populateFormFromTags(tags, mp3File) {
  if (!els.titleInput.value) els.titleInput.value = tags.title || mp3File?.name?.replace(/\.mp3$/i, '') || '';
  if (!els.artistInput.value) els.artistInput.value = tags.artist || '';
  if (!els.albumInput.value) els.albumInput.value = tags.album || '';
  if (!els.albumArtistInput.value) els.albumArtistInput.value = tags.albumArtist || tags.artist || '';
  if (!els.genreInput.value) els.genreInput.value = tags.genre || '';
  if (!els.yearInput.value) els.yearInput.value = String(tags.year || '').slice(0, 4);
  if (!els.trackInput.value) els.trackInput.value = String(tags.trackNumber || '').split('/')[0];
}
function buildTrackRecord({ id, metadata, mp3Hash, stegHash, durationSeconds }) {
  const title = metadata.title || 'Untitled';
  return {
    id,
    title,
    artist: metadata.artist || 'Unknown artist',
    album: metadata.album || 'Unknown album',
    albumArtist: metadata.albumArtist || metadata.artist || 'Unknown artist',
    genre: parseCsvList(metadata.genre),
    year: Number(metadata.year) || null,
    trackNumber: Number(metadata.trackNumber) || null,
    durationSeconds,
    imageFile: `library/images/${id}.png`,
    mp3File: `library/mp3/${id}.mp3`,
    stegFile: `library/stegmp3/${id}.steg.png`,
    addedAt: new Date().toISOString(),
    favorite: false,
    tags: parseCsvList(metadata.tags),
    hash: {
      mp3Sha256: mp3Hash,
      stegSha256: stegHash,
    },
    source: {
      metadataProvider: metadata.metadataProvider || 'manual+id3',
      imageProvider: metadata.imageProvider || 'user-upload',
      coverImageSource: metadata.coverImageSource || 'local file',
    },
  };
}
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
async function saveToLocalLibrary({ id, record, mp3Bytes, imageBytes, stegBytes }) {
  const response = await fetch(`${state.saveHelperUrl}/save-track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      record,
      files: {
        mp3Base64: bytesToBase64(mp3Bytes),
        imageBase64: bytesToBase64(imageBytes),
        stegBase64: bytesToBase64(stegBytes),
      },
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || 'Could not save the generated files into the local library.');
  }
  return result;
}
async function pingLocalLibraryService() {
  const response = await fetch(`${state.saveHelperUrl}/health`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'Local library service is not responding.');
  return result;
}
async function ensureLocalLibraryService() {
  try {
    await pingLocalLibraryService();
    return true;
  } catch {
    return false;
  }
}
async function startLocalLibraryService() {
  try {
    const response = await fetch(`${state.saveHelperUrl}/start`, { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'Could not start local library service.');
    return true;
  } catch {
    return false;
  }
}
async function refreshDuration(file) {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      const duration = Math.round(audio.duration || 0);
      URL.revokeObjectURL(audio.src);
      resolve(duration);
    };
    audio.onerror = () => resolve(0);
  });
}
async function handleImport(event) {
  event.preventDefault();
  clearStatus(els.importStatus);
  const mp3File = els.mp3Input.files?.[0];
  const imageFile = els.imageInput.files?.[0];
  if (!mp3File || !imageFile || !els.titleInput.value.trim() || !els.artistInput.value.trim()) {
    setStatus(els.importStatus, 'Choose a valid MP3, a valid image, and fill in title and artist first.', 'err');
    return;
  }
  try {
    let serviceReady = await ensureLocalLibraryService();
    if (!serviceReady) {
      await startLocalLibraryService();
      serviceReady = await ensureLocalLibraryService();
    }
    if (!serviceReady) {
      throw new Error('The local library service could not be started automatically.');
    }
    await loadPreviewImage(imageFile);
    const mp3Bytes = await bytesFromFile(mp3File);
    const encoded = await encodeSteg({ coverCanvas: els.importPreview, mp3Bytes, mp3Name: mp3File.name });
    const id = `${slugify(els.artistInput.value || 'artist')}-${slugify(els.titleInput.value || mp3File.name.replace(/\.mp3$/i, ''))}-${Date.now()}`;
    const durationSeconds = await refreshDuration(mp3File);
    const mp3Hash = hex(await sha256(mp3Bytes));
    const stegHash = hex(await sha256(encoded.stegBytes));
    const imageHash = hex(await sha256(await bytesFromFile(imageFile)));
    const metadata = {
      title: els.titleInput.value.trim(),
      artist: els.artistInput.value.trim(),
      album: els.albumInput.value.trim(),
      albumArtist: els.albumArtistInput.value.trim(),
      genre: els.genreInput.value.trim(),
      year: els.yearInput.value,
      trackNumber: els.trackInput.value,
      tags: els.tagsInput.value.trim(),
      metadataProvider: 'manual+id3',
      imageProvider: 'user-upload',
      coverImageSource: state.importImageName || imageFile.name,
    };
    const record = buildTrackRecord({ id, metadata, mp3Hash, stegHash, durationSeconds });
    record.hash.imageSha256 = imageHash;
    const imageBytes = await bytesFromFile(imageFile);
    await saveToLocalLibrary({
      id,
      record,
      mp3Bytes,
      imageBytes,
      stegBytes: encoded.stegBytes,
    });
    upsertTrack(state.tracks, record);
    renderFilterOptions();
    renderGallery();
    clearStatus(els.importStatus);
    els.importForm.reset();
  } catch (error) {
    setStatus(els.importStatus, error.message || String(error), 'err');
  }
}
async function runMetadataLookup() {
  const title = els.titleInput.value.trim();
  const artist = els.artistInput.value.trim();
  if (!title && !artist) {
    state.lookupMatches = [];
    setLookupMessage('Enter at least a title or artist first.');
    return;
  }
  setLookupMessage('Searching MusicBrainz...');
  const query = encodeURIComponent(`recording:${title || ''} artist:${artist || ''}`.trim());
  const response = await fetch(`https://musicbrainz.org/ws/2/recording?query=${query}&fmt=json&limit=5&inc=genres+tags+releases`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('MusicBrainz lookup failed.');
  const data = await response.json();
  state.lookupMatches = (data.recordings || []).slice(0, 5).map((item) => {
    const release = pickBestRelease(item);
    const chosen = summarizeRelease(release);
    return {
      title: item.title,
      artist: item['artist-credit']?.map((credit) => credit.name).join(', ') || 'Unknown',
      recordingMbid: item.id,
      releaseTitle: chosen.title,
      releaseMbid: chosen.mbid,
      year: chosen.year,
      releaseDate: chosen.date,
      releaseCountry: chosen.country,
      releaseStatus: chosen.status,
      releasePackaging: chosen.packaging,
      releaseDisambiguation: chosen.disambiguation,
      primaryType: chosen.primaryType,
      secondaryTypes: chosen.secondaryTypes,
      genre: (item.genres || []).map((entry) => entry.name).filter(Boolean),
      tags: (item.tags || []).map((entry) => entry.name).filter(Boolean),
    };
  });
  state.selectedLookupIndex = 0;
  renderLookupResults();
}

els.searchInput.addEventListener('input', renderGallery);
els.sortSelect.addEventListener('change', renderGallery);
els.genreFilter.addEventListener('change', renderGallery);
els.playlistFilter.addEventListener('change', renderGallery);
els.favoritesOnly.addEventListener('change', renderGallery);
els.imageInput.addEventListener('change', async () => {
  const file = els.imageInput.files?.[0];
  state.importImageValid = false;
  if (file) {
    try {
      const dims = await loadPreviewImage(file, file.name);
      clearStatus(els.importStatus);
    } catch (error) {
      setStatus(els.importStatus, error.message || String(error), 'err');
      if (state.importImageBitmap) {
        state.importImageBitmap.close?.();
        state.importImageBitmap = null;
      }
      updateGenerateState();
    }
  } else {
    if (state.importImageBitmap) {
      state.importImageBitmap.close?.();
      state.importImageBitmap = null;
    }
    updateGenerateState();
  }
});
els.cropXSlider.addEventListener('input', renderImportCropPreview);
els.cropYSlider.addEventListener('input', renderImportCropPreview);
els.mp3Input.addEventListener('change', () => {
  const file = els.mp3Input.files?.[0];
  state.importMp3Valid = Boolean(file && /\.mp3$/i.test(file.name || ''));
  updateGenerateState();
});
[els.titleInput, els.artistInput].forEach((input) => {
  input.addEventListener('input', updateGenerateState);
});
els.autofillBtn.addEventListener('click', async () => {
  const mp3File = els.mp3Input.files?.[0];
  if (!mp3File) return setStatus(els.importStatus, 'Choose an MP3 first.', 'err');
  clearStatus(els.importStatus);
  const tags = parseId3Tags(await bytesFromFile(mp3File));
  populateFormFromTags(tags, mp3File);
  clearStatus(els.importStatus);
});
els.lookupMetadataBtn.addEventListener('click', () => runMetadataLookup().catch((error) => { setLookupMessage(error.message || String(error)); }));
els.resetImportBtn.addEventListener('click', () => {
  els.importForm.reset();
  clearStatus(els.importStatus);
  state.lookupMatches = [];
  state.selectedLookupIndex = 0;
  state.importImageValid = false;
  state.importMp3Valid = false;
  if (state.importImageBitmap) {
    state.importImageBitmap.close?.();
    state.importImageBitmap = null;
  }
  state.importImageName = '';
  els.cropXSlider.value = '500';
  els.cropYSlider.value = '500';
  els.lookupResults.innerHTML = '';
  const ctx = els.importPreview.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  updateGenerateState();
});
els.importForm.addEventListener('submit', handleImport);
els.fullscreenBtn.addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await els.artworkCanvas.requestFullscreen();
});
els.importPreview.addEventListener('click', async () => {
  if (document.fullscreenElement === els.importPreview) await document.exitFullscreen();
  else await els.importPreview.requestFullscreen();
});
els.playPauseBtn.addEventListener('click', async () => {
  if (!els.audio.src) return;
  if (els.audio.paused) await els.audio.play();
  else els.audio.pause();
});
els.stopBtn.addEventListener('click', () => { els.audio.pause(); els.audio.currentTime = 0; });
els.prevBtn.addEventListener('click', () => stepTrack(-1));
els.nextBtn.addEventListener('click', () => stepTrack(1));
els.seekSlider.addEventListener('input', () => {
  if (els.audio.duration) els.audio.currentTime = (Number(els.seekSlider.value) / 1000) * els.audio.duration;
});
els.audio.addEventListener('play', () => { els.playPauseBtn.textContent = 'Pause'; });
els.audio.addEventListener('pause', () => { els.playPauseBtn.textContent = 'Play'; });
els.audio.addEventListener('timeupdate', () => {
  els.timeCurrent.textContent = formatTime(els.audio.currentTime);
  els.timeTotal.textContent = formatTime(els.audio.duration);
  if (els.audio.duration) els.seekSlider.value = String(Math.round((els.audio.currentTime / els.audio.duration) * 1000));
});
els.audio.addEventListener('ended', () => {
  if (els.autoplayNext.checked) stepTrack(1);
});
els.favoriteBtn.addEventListener('click', () => {
  const track = getCurrentTrack();
  if (!track) return;
  track.favorite = !track.favorite;
  els.favoriteBtn.textContent = track.favorite ? '★ Favorited' : '☆ Favorite';
  renderGallery();
});
els.toggleDeleteModeBtn?.addEventListener('click', () => {
  state.deleteMode = !state.deleteMode;
  renderGallery();
});

(async function init() {
  const ctx = els.importPreview.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  updateGenerateState();
  renderDeleteModeButton();
  ensureLocalLibraryService();
  try {
    const { tracks, playlists } = await loadLibrary();
    state.tracks = tracks;
    state.playlists = playlists;
    renderFilterOptions();
    renderGallery();
  } catch (error) {
    setStatus(els.playerStatus, error.message || String(error), 'err');
    renderGallery();
  }
})();