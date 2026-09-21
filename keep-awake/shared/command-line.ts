type CommandLineResult = { tokens: string[] } | { error: string };

// parseCommandLine is the entry point for callers; this is its lexical half and answers only
// whether the quoting is well formed. Hand-rolled rather than reused from a
// shell-parsing package: it only ever needs to understand quoting, not the rest of shell syntax
// (globs, pipes, env vars, ...), and pulling in a real shell grammar would let users write things
// spawning-without-a-shell can't run anyway.
function tokenizeCommandLine(input: string): CommandLineResult {
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

// Tokenising says whether the quoting is well formed; it does not say whether the result can be
// spawned. A blank argv[0] is the gap between the two: `"" -w {pid}` quotes correctly and tokenises
// cleanly, yet names no program to run. Both the settings screen and the server validate through
// here, so a command line this rejects is never saved and never spawned. It is not the whole of
// what spawning can reject -- a missing program still fails at spawn time, reported as a command
// error -- but it is the part worth catching before the hold silently stops working.
export function parseCommandLine(input: string): CommandLineResult {
  const parsed = tokenizeCommandLine(input);
  if ("error" in parsed) {
    return parsed;
  }
  // No tokens at all is the default "no custom command" rather than a bad one; a first token with
  // nothing visible in it names no program, and reports better here than as `spawn   ENOENT`.
  if (parsed.tokens.length > 0 && parsed.tokens[0].trim() === "") {
    return { error: "Command must start with a program name" };
  }
  return parsed;
}

// {pid} can appear mid-token (`--pid={pid}`), so this substitutes rather than requiring a
// standalone argument.
export function substitutePid(tokens: readonly string[], pid: number): string[] {
  return tokens.map((token) => token.replaceAll("{pid}", String(pid)));
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}
