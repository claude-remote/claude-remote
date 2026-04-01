import type {
  ConfigOptions,
  ContextUsage,
  CostSummary,
  McpServerInfo,
  Message,
  PermissionRequest,
  SessionConfig,
  SessionMeta,
  SkillInfo,
} from '@/shared/types';

import { BranchMenu } from '@/web/components/BranchMenu';
import { CompactPrompt } from '@/web/components/CompactPrompt';
import { ContextIndicator } from '@/web/components/ContextIndicator';
import { CostBadge } from '@/web/components/CostBadge';
import { ExportDialog } from '@/web/components/ExportDialog';
import { McpPanel } from '@/web/components/McpPanel';
import { MessageList } from '@/web/components/MessageList';
import { ModelSelector } from '@/web/components/ModelSelector';
import { NotificationCenter } from '@/web/components/NotificationCenter';
import { PermissionBanner } from '@/web/components/PermissionBanner';
import { SettingsDrawer } from '@/web/components/SettingsDrawer';
import { SkillPalette } from '@/web/components/SkillPalette';

export function Chat() {
  const messages: Message[] = [];
  const permissions: PermissionRequest[] = [];
  const skills: SkillInfo[] = [];
  const session: SessionMeta = {
    id: 'session-placeholder',
    name: 'New Session',
    cwd: '~/project',
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    clientCount: 0,
    hasActiveWriter: false,
  };
  const config: SessionConfig = {
    model: 'claude-sonnet',
    effortLevel: 'medium',
    permissionMode: 'ask',
  };
  const options: ConfigOptions = {
    availableModels: [],
    effortLevels: ['low', 'medium', 'high'],
    permissionModes: ['ask', 'approve', 'bypass'],
  };
  const usage: ContextUsage = { usedTokens: 0, maxTokens: 0, percentage: 0, breakdown: [] };
  const cost: CostSummary = {
    sessionCost: 0,
    formattedCost: '$0.00',
    inputTokens: 0,
    outputTokens: 0,
    apiCalls: 0,
    sessionDuration: 0,
  };
  const servers: McpServerInfo[] = [];

  // TODO(T14,T15,T16,T18,T19,T20,T21,T22,T23): compose the final mobile chat experience.
  return (
    <main className="space-y-4 p-4">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{session.name}</h1>
        <div className="flex gap-2">
          <ModelSelector config={config} options={options} />
          <ContextIndicator usage={usage} />
          <CostBadge cost={cost} />
        </div>
      </header>
      <NotificationCenter notifications={[]} />
      <PermissionBanner requests={permissions} />
      <SkillPalette skills={skills} />
      <CompactPrompt usage={usage} />
      <MessageList messages={messages} />
      <BranchMenu session={session} />
      <ExportDialog />
      <McpPanel servers={servers} />
      <SettingsDrawer config={config} servers={servers} />
    </main>
  );
}
