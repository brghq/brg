import pc from 'picocolors';

// brg brand palette — amber (#C9762F) for active/success indicators,
// everything else stays neutral. See CLAUDE.md brand identity section.
// picocolors has no truecolor API, so amber is a raw ANSI 24-bit escape,
// gated the same way picocolors gates its own colors.
export const amber = (s: string): string =>
  pc.isColorSupported ? `\x1b[38;2;201;118;47m${s}\x1b[0m` : s;
export const dim = (s: string): string => pc.dim(s);
export const bold = (s: string): string => pc.bold(s);
