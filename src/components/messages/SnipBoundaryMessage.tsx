import type * as React from 'react';
import { Text } from '../../ink.js';

export function SnipBoundaryMessage(_props: {
  message: unknown;
}): React.ReactNode {
  return <Text dimColor>Earlier transcript content was snipped.</Text>;
}
