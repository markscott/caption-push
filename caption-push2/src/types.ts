export interface CaptionStyle {
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  textAlign: 'left' | 'center' | 'right';
  displayMode: 'static' | 'scroll' | 'fade';
  scrollSpeed: number;
}

export interface CaptionLine {
  index: number;
  text: string;
  startMs?: number;
  endMs?: number;
  isMetadata?: boolean;
  sceneId: number;
}

export interface Preset {
  id: string;
  name: string;
  text: string;
}

export interface HistoryEntry {
  text: string;
  timestamp: number;
  style: CaptionStyle;
}

export type ChannelMessage =
  | { type: 'PUSH_CAPTION'; targets: number[] | 'all'; text: string; style: CaptionStyle; hold?: boolean; timestamp: number }
  | { type: 'CLEAR'; targets: number[] | 'all'; timestamp: number }
  | { type: 'BRIGHTNESS'; targets: number[] | 'all'; level: number; timestamp: number }
  | { type: 'HEARTBEAT'; displayId: number; timestamp: number }
  | { type: 'HEARTBEAT_REQ'; timestamp: number };

export const SPEED_STOPS = [0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const;
export const DEFAULT_SPEED_IDX = 4; // 1.0×

export const DEFAULT_STYLE: CaptionStyle = {
  fontSize: 300,
  fontFamily: 'Arial, sans-serif',
  color: '#ffffff',
  backgroundColor: '#000000',
  textAlign: 'center',
  displayMode: 'static',
  scrollSpeed: 800,
};

export const DEFAULT_PRESETS: Preset[] = [
  { id: 'p0', name: 'Show Captions', text: 'Show captions here!' },
  { id: 'p1', name: 'Welcome', text: 'Welcome to the show' },
  { id: 'p2', name: 'Intermission', text: 'Intermission – 15 minutes' },
  { id: 'p3', name: 'Silence Phones', text: 'Please silence your mobile phones' },
  { id: 'p4', name: 'Act One', text: 'Act One' },
  { id: 'p5', name: 'Act Two', text: 'Act Two' },
];
