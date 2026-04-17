const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.log('Usage: node tools/metadata-fetch.mjs "artist song"');
  process.exit(0);
}
const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'StegSuite/0.1 (local helper)' } });
if (!res.ok) throw new Error(`MusicBrainz error: HTTP ${res.status}`);
const data = await res.json();
for (const item of data.recordings || []) {
  const artist = item['artist-credit']?.map((credit) => credit.name).join(', ') || 'Unknown';
  const release = item.releases?.[0]?.title || 'n/a';
  console.log(`${item.title} | ${artist} | ${release} | ${item.id}`);
}
