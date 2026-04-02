import {
  ColorDiff,
  ColorFile,
  type SyntaxTheme,
  getSyntaxTheme as nativeGetSyntaxTheme,
} from 'color-diff-napi';
import { isEnvDefinedFalsy } from '../../utils/envUtils.js';

export type ColorModuleUnavailableReason = 'env';

/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via CLAUDE_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env';
  }
  return null;
}

export function expectColorDiff(): any | null {
  return (getColorModuleUnavailableReason() === null ? ColorDiff : null) as any;
}

export function expectColorFile(): any | null {
  return (getColorModuleUnavailableReason() === null ? ColorFile : null) as any;
}

export function getSyntaxTheme(themeName: string): SyntaxTheme | null {
  return getColorModuleUnavailableReason() === null ? nativeGetSyntaxTheme(themeName) : null;
}
