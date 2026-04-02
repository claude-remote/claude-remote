export type CacheEditsBlock = any

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  pinnedEdits: PinnedCacheEdits[]
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
}

export function createCachedMCState(): CachedMCState {
  return {
    pinnedEdits: [],
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
  }
}

export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: string): boolean {
  return false
}

export function getCachedMCConfig(): {
  triggerThreshold: number
  keepRecent: number
  supportedModels: string[]
} {
  return {
    triggerThreshold: 0,
    keepRecent: 0,
    supportedModels: [],
  }
}

export function registerToolResult(
  state: CachedMCState,
  toolUseId: string,
): void {
  state.registeredTools.add(toolUseId)
  if (!state.toolOrder.includes(toolUseId)) {
    state.toolOrder.push(toolUseId)
  }
}

export function registerToolMessage(
  _state: CachedMCState,
  _groupIds: string[],
): void {}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolsToDelete: string[],
): CacheEditsBlock | null {
  return null
}

export function markToolsSentToAPI(_state: CachedMCState): void {}

export function resetCachedMCState(state: CachedMCState): void {
  state.pinnedEdits = []
  state.registeredTools.clear()
  state.toolOrder = []
  state.deletedRefs.clear()
}
