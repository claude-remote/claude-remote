import type { HubResponse } from '../HubProtocol.js';

export const HUB_CHAT_NOT_IMPLEMENTED_NOTICE =
  'Hub baseline is connected, but chat is not implemented yet.';

export function mapHubChatErrorToNotice(response: HubResponse): string {
  if (response.type === 'error' && response.error.includes('not implemented')) {
    return HUB_CHAT_NOT_IMPLEMENTED_NOTICE;
  }

  if (response.type === 'error') {
    return response.error;
  }

  return '';
}
