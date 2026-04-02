import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import type * as React from 'react';
import { Box, Text } from '../../ink.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};

export function UserCrossSessionMessage({ addMargin, param }: Props): React.ReactNode {
  return (
    <Box paddingLeft={addMargin ? 2 : 0}>
      <Text>{param.text}</Text>
    </Box>
  );
}
