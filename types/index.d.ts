export type Topic = { name: string; count: number }

declare module 'claude-code' {
  interface PluginState {
    offtopic: { topics: Shaped<Topic[]>; pending: number; isHidden: boolean; isSeeded: boolean }
  }
}
