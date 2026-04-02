// Content for the verify bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import skillMd from './verify/SKILL.md';
import cliMd from './verify/examples/cli.md';
import serverMd from './verify/examples/server.md';

export const SKILL_MD: string = skillMd;

export const SKILL_FILES: Record<string, string> = {
  'examples/cli.md': cliMd,
  'examples/server.md': serverMd,
};
