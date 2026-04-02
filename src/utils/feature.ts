const truthyValues = new Set(['1', 'true', 'yes', 'on']);
const falsyValues = new Set(['0', 'false', 'no', 'off']);

export function feature(name: string): boolean {
  const explicitOverride = getExplicitOverride(name);
  if (explicitOverride !== undefined) {
    return explicitOverride;
  }

  return getEnabledFeaturesFromLists().has(normalizeFeatureName(name));
}

function getExplicitOverride(name: string): boolean | undefined {
  const normalized = normalizeFeatureName(name);
  const variableNames = [
    `CLAUDE_REMOTE_FEATURE_${normalized}`,
    `CLAUDE_CODE_FEATURE_${normalized}`,
  ];

  for (const variableName of variableNames) {
    const value = process.env[variableName];
    if (value === undefined) {
      continue;
    }

    const parsed = parseBoolean(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function getEnabledFeaturesFromLists(): Set<string> {
  return new Set(
    [process.env.CLAUDE_REMOTE_FEATURES, process.env.CLAUDE_CODE_FEATURES]
      .flatMap((value) => splitFeatureList(value))
      .map(normalizeFeatureName),
  );
}

function splitFeatureList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFeatureName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase();
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (truthyValues.has(normalized)) {
    return true;
  }

  if (falsyValues.has(normalized)) {
    return false;
  }

  return undefined;
}
