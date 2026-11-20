const themes = {
  'Variété française': 'variété française',
  'Rock années 80': 'rock 80s',
  'Pop années 90': 'pop 90s',
  'Hip-hop': 'hip hop',
  'Disco': 'disco',
  'Musiques de jeux vidéo': 'video game soundtrack',
  'Daft Punk': 'daft punk',
  'Queen': 'queen',
  'Hits des années 2000': 'hits 2000s',
};

const alternateVersion = /\b(cover|karaoke|tribute|instrumental|made famous|in the style|originally performed)\b/i;

function tracksFrom(results) {
  const titles = new Set();
  return results.flatMap(track => {
    const title = track?.title_short || track?.title;
    const artist = track?.artist?.name;
    if (typeof title !== 'string' || typeof artist !== 'string' || !Number.isSafeInteger(track.id)) return [];
    if (alternateVersion.test([title, artist, track.album?.title].join(' '))) return [];
    const key = title.toLowerCase().replace(/\(.*?\)|\[.*?\]|\s+-\s+.*$/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!key || titles.has(key) || typeof track.preview !== 'string') return [];
    let preview;
    try { preview = new URL(track.preview); } catch { return []; }
    if (preview.protocol !== 'https:' || !(preview.hostname === 'dzcdn.net' ||
        preview.hostname.endsWith('.dzcdn.net'))) return [];
    titles.add(key);
    return [{ title, artist, preview: preview.href, id: track.id }];
  });
}

async function search(theme) {
  if (!Object.hasOwn(themes, theme)) throw new Error('Choisis un thème Deezer.');
  const url = new URL('https://api.deezer.com/search');
  url.searchParams.set('q', themes[theme]);
  url.searchParams.set('limit', '100');
  let data;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    data = await response.json();
  } catch {
    throw new Error('Impossible de joindre Deezer pour le moment. Réessaie dans quelques instants.');
  }
  if (!Array.isArray(data?.data)) throw new Error('Deezer ne fournit pas de résultats pour le moment.');
  const tracks = tracksFrom(data.data);
  if (!tracks.length) throw new Error('Aucun extrait disponible pour ce thème. Essaie un autre thème.');
  return tracks;
}

module.exports = { search, themes };
