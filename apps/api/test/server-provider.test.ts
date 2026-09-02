import { describe, expect, it } from 'vitest';
import { normalizeSourceServer } from '../src/providers/sanka/source-provider.js';

describe('normalizeSourceServer', () => {
  it('maps a provider server response into an embeddable playback source', () => {
    expect(normalizeSourceServer('samehadaku', 'server-1', { data: { url: 'https://embed.example/server-1' } })).toEqual({
      label: 'Resolved server',
      quality: null,
      kind: 'embed',
      mode: 'unknown',
      reason: 'not_verified',
      url: 'https://embed.example/server-1',
      serverId: 'server-1'
    });
  });
});
