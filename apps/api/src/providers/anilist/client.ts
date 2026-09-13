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

export class PosterRateLimitError extends Error {
  constructor() {
    super('AniList poster resolver rate limited');
  }
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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
  const asciiNormalized = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const candidates = [title, normalized, asciiNormalized];
  const seasonAlias = normalized.replace(/\bS(\d+)\b/gi, (_match, value: string) => `${seasonOrdinal(value)} Season`);
  if (seasonAlias !== normalized) candidates.push(seasonAlias);
  const spacedDewa = normalized.replace(/\bdewa\b/gi, 'de wa');
  if (spacedDewa !== normalized) candidates.push(spacedDewa);
  const romanSeasonAlias = normalized.replace(/\bSeason 2\b/i, 'II');
  if (romanSeasonAlias !== normalized) candidates.push(romanSeasonAlias);
  const ordinalSeasonAlias = normalized.replace(/\bSeason 2\b/i, '2nd Season');
  if (ordinalSeasonAlias !== normalized) candidates.push(ordinalSeasonAlias);
  if (/^Tensei shitara Slime Datta Ken(?: Season \d+)?$/i.test(normalized)) {
    candidates.push('That Time I Got Reincarnated as a Slime');
  }
  if (/^Futsutsuka na Akujo de wa Gozaimasu ga$/i.test(spacedDewa)) {
    candidates.push('Futsutsuka na Akujo de wa Gozaimasu ga: Suuguu Chouso Torikae Den');
  }
  if (/^Vigilante Boku no Hero Academia Illegals 2nd Season$/i.test(ordinalSeasonAlias)) {
    candidates.push('Vigilante: Boku no Hero Academia ILLEGALS 2nd Season');
  }
  if (/^Degarashi Ouji$/i.test(normalized)) {
    candidates.push('Saikyou Degarashi Ouji no Anyaku Teii Arasoi: Munou wo Enjiru SS Rank Ouji wa Koui Keishousen wo Kage kara Shihai suru');
  }
  if (/^JoJo['']s Bizarre Adventure\s*\d?\s*:?\s*Steel Ball Run$/i.test(normalized) ||
      /^JoJo\s?s Bizarre Adventure\s*\d?\s*:?\s*Steel Ball Run$/i.test(normalized) ||
      /^\d*\s*Steel Ball Run$/i.test(normalized)) {
    candidates.push('JoJo no Kimyou na Bouken: Steel Ball Run');
  }

  for (let index = 0; index <= words.length - 4; index += 1) {
    candidates.push(words.slice(index, index + 4).join(' '));
  }
  if (words.length >= 3) candidates.push(words.slice(0, 3).join(' '));

  return [...new Set(candidates.filter(Boolean))];
}

export class AniListPosterClient {
  private readonly cache = new Map<string, string | null>();
  private nextRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
    private readonly minRequestIntervalMs = 3500
  ) {}

  private async fetchCandidate(url: string, init: RequestInit): Promise<Response> {
    let release!: () => void;
    const previous = this.requestQueue;
    this.requestQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const waitFor = this.nextRequestAt - Date.now();
      if (waitFor > 0) await sleep(waitFor);
      this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
      return await this.fetcher(url, init);
    } finally {
      release();
    }
  }

  async resolve(title: string): Promise<string | null> {
    const cached = this.cache.get(title);
    if (cached !== undefined) return cached;

    for (const search of searchCandidates(title)) {
      try {
        const response = await this.fetchCandidate('https://graphql.anilist.co', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify({ query, variables: { search } })
        });
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after'));
          this.nextRequestAt = Date.now() + Math.max(this.minRequestIntervalMs, Number.isFinite(retryAfter) ? retryAfter * 1000 : 60_000);
          throw new PosterRateLimitError();
        }
        if (!response.ok) continue;

        const payload = (await response.json()) as AniListResponse;
        const posterUrl = payload.data?.Media?.coverImage?.large
          ?? payload.data?.Media?.coverImage?.medium
          ?? null;
        if (posterUrl) {
          this.cache.set(title, posterUrl);
          return posterUrl;
        }
      } catch (cause) {
        if (cause instanceof PosterRateLimitError) throw cause;
        // Try the next candidate; the original provider poster remains the fallback.
      }
    }

    return null;
  }
}
