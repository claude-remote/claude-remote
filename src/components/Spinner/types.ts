export type SpinnerMode =
  | 'requesting'
  | 'responding'
  | 'tool-input'
  | 'tool-use'
  | 'thinking'
  | 'idle';

export type RGBColor = {
  r: number;
  g: number;
  b: number;
};
