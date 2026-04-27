/**
 * Word-level diff between two short strings (PR-34/35/36/37).
 *
 * Used to render before/after suggestion diffs in the dashboard,
 * Figma plugin, GitHub Action PR comment, and LSP code action UIs —
 * one shared algorithm so every surface highlights the same edits the
 * same way.
 *
 * Word-level (not character-level) because the inputs are UI copy:
 * users are reading natural language, not symbols, and char-level
 * diffs of typo-prefixed/suffixed words ("Click→Sign" highlighted
 * letter by letter) read as visual noise. Word boundaries match how
 * a human would describe the change ("they swapped 'here' for 'up
 * for the trial'").
 *
 * Algorithm: classic LCS DP table. Inputs are short (UI copy, almost
 * always < 200 words), so O(m*n) memory + time is fine. No external
 * dependency.
 */

export type DiffToken =
  | { kind: "equal"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "added"; text: string };

/**
 * Tokenize a string into alternating word + whitespace pieces. Keeping
 * whitespace as its own token preserves the original formatting in the
 * "equal" path (so the rendered diff doesn't collapse double-spaces or
 * lose newlines).
 */
function tokenize(s: string): string[] {
  if (!s) return [];
  // Split on word boundaries while preserving the delimiters. Each
  // token is either a run of word characters or a run of non-word
  // characters (whitespace + punctuation).
  return s.match(/\w+|[^\w]+/g) ?? [];
}

/**
 * Returns a token stream representing the edit script from `before` to
 * `after`. Adjacent tokens of the same kind are merged so callers don't
 * have to coalesce them when rendering.
 */
export function wordDiff(before: string, after: string): DiffToken[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const m = a.length;
  const n = b.length;

  // dp[i][j] = LCS length for a[i..] vs b[j..]
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      pushToken(out, { kind: "equal", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushToken(out, { kind: "removed", text: a[i] });
      i++;
    } else {
      pushToken(out, { kind: "added", text: b[j] });
      j++;
    }
  }
  while (i < m) {
    pushToken(out, { kind: "removed", text: a[i] });
    i++;
  }
  while (j < n) {
    pushToken(out, { kind: "added", text: b[j] });
    j++;
  }
  return out;
}

/** Append a token; merge with the previous one when the kind matches. */
function pushToken(tokens: DiffToken[], next: DiffToken) {
  const last = tokens[tokens.length - 1];
  if (last && last.kind === next.kind) {
    last.text += next.text;
  } else {
    tokens.push(next);
  }
}

/**
 * Convenience: render a diff token stream as a unified-style markdown
 * snippet for surfaces that don't support inline HTML (the GitHub
 * Action PR comment in particular). Removed tokens get `~~strikethrough~~`,
 * added get `**bold**`. Suitable for pasting into GitHub-flavored
 * markdown.
 */
export function renderDiffMarkdown(tokens: DiffToken[]): string {
  return tokens
    .map((t) => {
      if (t.kind === "equal") return t.text;
      if (t.kind === "removed") return `~~${t.text}~~`;
      return `**${t.text}**`;
    })
    .join("");
}
