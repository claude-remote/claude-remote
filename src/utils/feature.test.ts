import { afterEach, describe, expect, test } from 'bun:test';
import { feature } from './feature.js';

const originalRemoteFeatures = process.env.CLAUDE_REMOTE_FEATURES;
const originalCodeFeatures = process.env.CLAUDE_CODE_FEATURES;
const originalSpecificRemote = process.env.CLAUDE_REMOTE_FEATURE_BRIDGE_MODE;
const originalSpecificCode = process.env.CLAUDE_CODE_FEATURE_BRIDGE_MODE;

afterEach(() => {
  restoreEnv('CLAUDE_REMOTE_FEATURES', originalRemoteFeatures);
  restoreEnv('CLAUDE_CODE_FEATURES', originalCodeFeatures);
  restoreEnv('CLAUDE_REMOTE_FEATURE_BRIDGE_MODE', originalSpecificRemote);
  restoreEnv('CLAUDE_CODE_FEATURE_BRIDGE_MODE', originalSpecificCode);
});

describe('feature', () => {
  test('returns false by default when no runtime feature source exists', () => {
    process.env.CLAUDE_REMOTE_FEATURES = undefined;
    process.env.CLAUDE_CODE_FEATURES = undefined;
    process.env.CLAUDE_REMOTE_FEATURE_BRIDGE_MODE = undefined;
    process.env.CLAUDE_CODE_FEATURE_BRIDGE_MODE = undefined;

    expect(feature('BRIDGE_MODE')).toBe(false);
  });

  test('reads enabled features from environment lists and explicit overrides', () => {
    process.env.CLAUDE_REMOTE_FEATURES = 'bridge_mode,bg_sessions';
    expect(feature('BRIDGE_MODE')).toBe(true);

    process.env.CLAUDE_REMOTE_FEATURE_BRIDGE_MODE = '0';
    expect(feature('BRIDGE_MODE')).toBe(false);

    process.env.CLAUDE_REMOTE_FEATURE_BRIDGE_MODE = undefined;
    process.env.CLAUDE_CODE_FEATURE_BRIDGE_MODE = '1';
    expect(feature('BRIDGE_MODE')).toBe(true);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
