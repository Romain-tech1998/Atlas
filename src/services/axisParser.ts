/**
 * The first pipeline stage: normalizes raw input before it reaches the
 * Intent and Entity Engines. Intent classification and entity extraction
 * now live in src/brain/intent and src/brain/entity respectively — this
 * stays a thin, dedicated normalization step.
 */
function normalize(rawInput: string): string {
  return rawInput.trim().replace(/\s+/g, " ");
}

export const axisParser = { normalize };
