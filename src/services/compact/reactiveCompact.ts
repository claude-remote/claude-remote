export function isReactiveOnlyMode(): boolean {
  return false;
}

export type ReactiveCompactOutcome =
  | {
      ok: true;
      result: {
        userDisplayMessage?: string;
      };
    }
  | {
      ok: false;
      reason:
        | 'too_few_groups'
        | 'aborted'
        | 'exhausted'
        | 'error'
        | 'media_unstrippable';
    };

export async function reactiveCompactOnPromptTooLong(
  ..._args: any[]
): Promise<ReactiveCompactOutcome> {
  return { ok: false, reason: 'too_few_groups' };
}
