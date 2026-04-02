import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_HUB_CONFIG, getDefaultHubConfigPath, loadHubConfig } from '../config.js';

const tempPaths: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('hub config', () => {
  it('loads config.toml and expands allowed roots', () => {
    const homeDir = makeTempDir('hub-config-home-');
    const extraRoot = join(homeDir, 'workspace');
    const homeRoot = join(homeDir, 'projects');
    mkdirSync(extraRoot, { recursive: true });
    mkdirSync(homeRoot, { recursive: true });

    const configPath = join(homeDir, '.claude-remote', 'config.toml');
    mkdirSync(join(homeDir, '.claude-remote'), { recursive: true });
    writeFileSync(
      configPath,
      `
[server]
port = 4567
log_level = "warn"

[limits]
max_sessions = 12
max_messages_in_memory = 1500
max_concurrent_tools = 7
max_connections_per_session = 3
idle_timeout_ms = 600000

[auth]
session_token_ttl = "14d"
totp_enabled = true

[files]
allowed_roots = ["~/projects", "${extraRoot}"]
excluded_dirs = [".ssh", ".gnupg"]

[tunnel]
auto_start = true
provider = "cloudflare"
`.trim(),
    );

    const config = loadHubConfig({
      configPath,
      env: { HOME: homeDir },
    });

    expect(config.port).toBe(4567);
    expect(config.logLevel).toBe('warn');
    expect(config.maxSessions).toBe(12);
    expect(config.maxMessagesInMemory).toBe(1500);
    expect(config.maxConcurrentTools).toBe(7);
    expect(config.maxConnectionsPerSession).toBe(3);
    expect(config.idleTimeoutMs).toBe(600000);
    expect(config.sessionTokenTtl).toBe('14d');
    expect(config.totpEnabled).toBe(true);
    expect(config.allowedRoots).toEqual([homeRoot, extraRoot]);
    expect(config.excludedDirs).toEqual(['.ssh', '.gnupg']);
    expect(config.tunnelAutoStart).toBe(true);
    expect(config.tunnelProvider).toBe('cloudflare');
  });

  it('applies CLI > env > file > defaults precedence', () => {
    const homeDir = makeTempDir('hub-config-precedence-');
    const allowedRoot = join(homeDir, 'repo');
    mkdirSync(allowedRoot, { recursive: true });

    const configPath = join(homeDir, '.claude-remote', 'config.toml');
    mkdirSync(join(homeDir, '.claude-remote'), { recursive: true });
    writeFileSync(
      configPath,
      `
[server]
port = 3000
log_level = "info"

[limits]
max_sessions = 8

[files]
allowed_roots = ["${allowedRoot}"]
`.trim(),
    );

    const config = loadHubConfig({
      configPath,
      env: {
        HOME: homeDir,
        CLAUDE_REMOTE_PORT: '4000',
        CLAUDE_REMOTE_LOG_LEVEL: 'error',
        CLAUDE_REMOTE_MAX_SESSIONS: '20',
      },
      cli: {
        port: 5000,
        logLevel: 'debug',
      },
    });

    expect(config.port).toBe(5000);
    expect(config.logLevel).toBe('debug');
    expect(config.maxSessions).toBe(20);
    expect(config.maxMessagesInMemory).toBe(DEFAULT_HUB_CONFIG.maxMessagesInMemory);
    expect(config.allowedRoots).toEqual([allowedRoot]);
  });

  it('uses defaults when config file is missing', () => {
    const homeDir = makeTempDir('hub-config-defaults-');

    const config = loadHubConfig({
      configPath: join(homeDir, '.claude-remote', 'config.toml'),
      env: { HOME: homeDir },
      cli: {
        allowedRoots: [homeDir],
      },
    });

    expect(config.port).toBe(DEFAULT_HUB_CONFIG.port);
    expect(config.logLevel).toBe(DEFAULT_HUB_CONFIG.logLevel);
    expect(config.allowedRoots).toEqual([homeDir]);
    expect(getDefaultHubConfigPath({ HOME: homeDir })).toBe(
      join(homeDir, '.claude-remote', 'config.toml'),
    );
  });

  it('rejects invalid values', () => {
    const homeDir = makeTempDir('hub-config-invalid-');
    const configPath = join(homeDir, '.claude-remote', 'config.toml');
    mkdirSync(join(homeDir, '.claude-remote'), { recursive: true });
    writeFileSync(
      configPath,
      `
[server]
port = 99999

[files]
allowed_roots = ["${join(homeDir, 'missing')}"]
`.trim(),
    );

    expect(() =>
      loadHubConfig({
        configPath,
        env: { HOME: homeDir },
      }),
    ).toThrow(/port|allowed_roots/i);
  });

  it('rejects non-string entries in path arrays', () => {
    const homeDir = makeTempDir('hub-config-array-types-');
    const configPath = join(homeDir, '.claude-remote', 'config.toml');
    mkdirSync(join(homeDir, '.claude-remote'), { recursive: true });
    writeFileSync(
      configPath,
      `
[files]
allowed_roots = [123]
excluded_dirs = [456]
`.trim(),
    );

    expect(() =>
      loadHubConfig({
        configPath,
        env: { HOME: homeDir },
      }),
    ).toThrow(/allowed_roots|excluded_dirs/i);
  });

  it('rejects malformed numeric env values instead of truncating them', () => {
    const homeDir = makeTempDir('hub-config-invalid-env-number-');

    expect(() =>
      loadHubConfig({
        env: {
          HOME: homeDir,
          CLAUDE_REMOTE_PORT: '3456abc',
        },
        cli: {
          allowedRoots: [homeDir],
        },
      }),
    ).toThrow(/CLAUDE_REMOTE_PORT/i);
  });
});
