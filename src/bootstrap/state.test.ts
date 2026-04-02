import { describe, expect, test } from 'bun:test';
import { isReplBridgeActive, setReplBridgeActive } from './state.js';

describe('bootstrap state repl bridge flags', () => {
  test('tracks repl bridge activity in exported state helpers', () => {
    setReplBridgeActive(false);
    expect(isReplBridgeActive()).toBe(false);

    setReplBridgeActive(true);
    expect(isReplBridgeActive()).toBe(true);

    setReplBridgeActive(false);
  });
});
