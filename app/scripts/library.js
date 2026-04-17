import { parseCsvList } from './steg-core.js';

export async function loadLibrary() {
  const [tracksRes, playlistsRes] = await Promise.all([
    fetch('../library/metadata/index.json', { cache: 'no-store' }),
    fetch('../library/playlists/index.json', { cache: 'no-store' }),
  ]);
  if (!tracksRes.ok) throw new Error('Could not load library metadata.');
  const tracks = await tracksRes.json();
  const playlists = playlistsRes.ok ? await playlistsRes.json() : [];
  return {
    tracks: tracks.map(normalizeTrack),
    playlists,
  };
}

export function normalizeTrack(track) {
  return {
    favorite: false,
    tags: [],
    genre: [],
    playlistIds: [],
    ...track,
    genre: Array.isArray(track.genre) ? track.genre : parseCsvList(track.genre),
    tags: Array.isArray(track.tags) ? track.tags : parseCsvList(track.tags),
  };
}

export function applyFilters(tracks, filters, playlists) {
  const list = [...tracks].filter((track) => {
    const haystack = [track.title, track.artist, track.album, ...(track.tags || []), ...(track.genre || [])].join(' ').toLowerCase();
    if (filters.search && !haystack.includes(filters.search.toLowerCase())) return false;
    if (filters.genre && !(track.genre || []).includes(filters.genre)) return false;
    if (filters.favoritesOnly && !track.favorite) return false;
    if (filters.playlist) {
      const playlist = playlists.find((item) => item.id === filters.playlist);
      if (!playlist?.trackIds?.includes(track.id)) return false;
    }
    return true;
  });

  const sorters = {
    recent: (a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    artist: (a, b) => (a.artist || '').localeCompare(b.artist || ''),
    album: (a, b) => (a.album || '').localeCompare(b.album || ''),
    year: (a, b) => (b.year || 0) - (a.year || 0),
    duration: (a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0),
  };
  return list.sort(sorters[filters.sort] || sorters.recent);
}

export function collectGenres(tracks) {
  return [...new Set(tracks.flatMap((track) => track.genre || []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function libraryStats(tracks) {
  const count = tracks.length;
  const seconds = tracks.reduce((sum, track) => sum + (Number(track.durationSeconds) || 0), 0);
  const hours = (seconds / 3600).toFixed(1);
  return `${count} track${count === 1 ? '' : 's'} • ${hours} hrs`;
}

export function upsertTrack(tracks, nextTrack) {
  const index = tracks.findIndex((track) => track.id === nextTrack.id);
  if (index >= 0) tracks.splice(index, 1, normalizeTrack(nextTrack));
  else tracks.unshift(normalizeTrack(nextTrack));
}
