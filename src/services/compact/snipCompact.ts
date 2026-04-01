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
