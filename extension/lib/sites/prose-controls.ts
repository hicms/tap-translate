/** Controls nested in reading content are not prose, including custom elements. */
export const PROSE_CONTROLS = [
  'form', '[role="textbox"]', '[role="button"]', '[role="menu"]', '[role="toolbar"]',
] as const;
