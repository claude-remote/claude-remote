export function isReactiveOnlyMode(): boolean {
  return false;
}

export async function reactiveCompactOnPromptTooLong(): Promise<any> {
  return { ok: false, reason: 'too_few_groups' };
}
