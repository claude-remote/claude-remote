export function isReactiveOnlyMode(): boolean {
  return false;
}

export function isReactiveCompactEnabled(): boolean {
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

export function isWithheldPromptTooLong(_message: any): boolean {
  return false;
}

export function isWithheldMediaSizeError(_message: any): boolean {
  return false;
}

export async function tryReactiveCompact(..._args: any[]): Promise<null> {
  return null;
}
