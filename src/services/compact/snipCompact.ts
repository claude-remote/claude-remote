export const SNIP_NUDGE_TEXT =
  'Older transcript content was trimmed. Use /snip when you want to reduce stale history.';

export function isSnipMarkerMessage(_message: any): boolean {
  return false;
}

export function isSnipRuntimeEnabled(): boolean {
  return false;
}

export function shouldNudgeForSnips(_messages: any[]): boolean {
  return false;
}

export function snipCompactIfNeeded(...args: any[]): {
  messages: any[];
  tokensFreed: number;
  boundaryMessage: null;
} {
  return {
    messages: args[0] ?? [],
    tokensFreed: 0,
    boundaryMessage: null,
  };
}
