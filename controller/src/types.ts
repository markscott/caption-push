export interface CaptionLine {
  index: number
  text: string
  startMs?: number
  endMs?: number
}

export type ClientMessage =
  | { type: 'show'; text: string; color?: string; align?: string }
  | { type: 'clear' }
  | { type: 'brightness'; level: number }
  | { type: 'identify'; id?: number }

export type ServerMessage =
  | { type: 'ack'; cmd: string; seq: number }
  | { type: 'error'; message: string }
