export type TokenizeResult = { tokens: string[] } | { error: string };

// Hand-rolled rather than reused from a shell-parsing package: this only ever needs to
// understand quoting, not the rest of shell syntax (globs, pipes, env vars, ...), and pulling
// in a real shell grammar would let users write things spawning-without-a-shell can't run anyway.
export function tokenizeCommandLine(input: string): TokenizeResult {
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let quote: '"' | "'" | null = null;

  for (const char of input) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
      continue;
    }
    if (isWhitespace(char)) {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
      continue;
    }
    current += char;
    inToken = true;
  }

  if (quote !== null) {
    return { error: `Unbalanced ${quote} quote` };
  }
  if (inToken) {
    tokens.push(current);
  }
  return { tokens };
}

// {pid} can appear mid-token (`--pid={pid}`), so this substitutes rather than requiring a
// standalone argument.
export function substitutePid(tokens: readonly string[], pid: number): string[] {
  return tokens.map((token) => token.replaceAll("{pid}", String(pid)));
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}
