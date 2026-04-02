import { describe, expect, test } from 'bun:test';
import { getHubSocketPath } from './paths.js';

describe('hub paths', () => {
  test('returns the default unix socket path under ~/.claude-remote', () => {
    expect(getHubSocketPath()).toContain('.claude-remote');
    expect(getHubSocketPath()).toContain('hub.sock');
  });
});
