import type { DisplayMode } from './types';

/**
 * What a display mode lets a client see of an execution. One rule for every
 * emitter - the platform's runtime, the server SDK's own tool results, and the
 * persisted conversation - so a card shows the same thing live and after a
 * reload.
 */
export interface DisplayReveal {
  /** The entity appears at all (a card exists). */
  visible: boolean;
  /** Its label and its errors. */
  label: boolean;
  /** Its arguments or input, live and persisted. */
  input: boolean;
  /** Its result or output. */
  output: boolean;
  /** Its nested activity (a worker's tool calls, text, and reasoning). */
  nested: boolean;
}

const HIDDEN: DisplayReveal = {
  visible: false,
  label: false,
  input: false,
  output: false,
  nested: false,
};
const TITLE: DisplayReveal = {
  visible: true,
  label: true,
  input: false,
  output: false,
  nested: false,
};
const STREAM: DisplayReveal = {
  visible: true,
  label: true,
  input: true,
  output: true,
  nested: true,
};

/**
 * The reveal rule: `hidden` shows nothing, `title` shows the label and errors,
 * `stream` shows everything. An unset mode reads as `title`, the default for a
 * labeled indicator, and so does a value this version does not know (a part
 * persisted under an earlier contract, a newer server): the same fallback the
 * wire schema applies, so a caller that bypasses the parser gets it too.
 */
export function displayReveals(display: DisplayMode | undefined): DisplayReveal {
  switch (display) {
    case 'hidden':
      return HIDDEN;
    case 'stream':
      return STREAM;
    case 'title':
    case undefined:
    default:
      // `default` is reached by a value outside the type that bypassed the parser.
      return TITLE;
  }
}
