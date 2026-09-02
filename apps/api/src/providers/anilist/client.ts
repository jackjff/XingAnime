type AniListResponse = {
  data?: {
    Media?: {
      coverImage?: {
        large?: string | null;
        medium?: string | null;
      } | null;
    } | null;
  };
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const query = `query ($search: String) {
  Media(search: $search, type: ANIME) {
    coverImage { large medium }
  }
}`;

function seasonOrdinal(value: string): string {
  const number = Number(value);
  if (number % 100 >= 11 && number % 100 <= 13) return `${number}th`;
  if (number % 10 === 1) return `${number}st`;
  if (number % 10 === 2) return `${number}nd`;
  if (number % 10 === 3) return `${number}rd`;
  return `${number}th`;
}

function searchCandidates(title: string): string[] {
  const normalized = title.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const candidates = [title, normalized];
  const seasonAlias = normalized.replace(/\bS(\d+)\b/gi, (_match, value: string) => `${seasonOrdinal(value)} Season`);
  if (seasonAlias !== normalized) candidates.push(seasonAlias);

  for (let index = 0; index <= words.length - 4; index += 1) {
    candidates.push(words.slice(index, index + 4).join(' '));
  }
  if (words.length >= 3) candidates.push(words.slice(0, 3).join(' '));

  return [...new Set(candidates.filter(Boolean))];
}

export class AniListPosterClient {
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly fetcher: Fetcher = (url, init) => fetch(url, init)) {}

  async resolve(title: string): Promise<string | null> {
    const cached = this.cache.get(title);
    if (cached !== undefined) return cached;

    for (const search of searchCandidates(title)) {
      try {
        const response = await this.fetcher('https://graphql.anilist.co', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify({ query, variables: { search } })
        });
        if (!response.ok) continue;

        const payload = (await response.json()) as AniListResponse;
        const posterUrl = payload.data?.Media?.coverImage?.large
          ?? payload.data?.Media?.coverImage?.medium
          ?? null;
        if (posterUrl) {
          this.cache.set(title, posterUrl);
          return posterUrl;
        }
      } catch {
        // Try the next candidate; the original provider poster remains the fallback.
      }
    }

    this.cache.set(title, null);
    return null;
  }
}
