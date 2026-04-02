import { TerminalEvent } from './terminal-event.js';

export class ResizeEvent extends TerminalEvent {
  readonly rows: number;
  readonly columns: number;

  constructor(rows: number, columns: number) {
    super('resize', { bubbles: false, cancelable: false });
    this.rows = rows;
    this.columns = columns;
  }
}
