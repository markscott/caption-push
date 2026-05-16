export interface CaptionLine {
  index: number
  text: string
  startMs?: number
  endMs?: number
  isMetadata?: boolean  // ## lines — shown to operator but never sent to display
  sceneId: number       // 0 = pre-scene preamble, increments with each ##SCENE line
}

export type ClientMessage =
  | { type: 'show'; text: string; color?: string; align?: string; hold?: boolean }
  | { type: 'preload'; text: string; color?: string; align?: string }
  | { type: 'clear' }
  | { type: 'brightness'; level: number }
  | { type: 'identify'; id?: number }

export type ServerMessage =
  | { type: 'ack'; cmd: string; seq: number }
  | { type: 'error'; message: string }
