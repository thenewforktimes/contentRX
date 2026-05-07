/**
 * Calibration-log markdown renderer.
 *
 * Renders the templated markdown emitted by
 * `reports/calibration/generate.py` into proper JSX. The page used to
 * dump the file as a `<pre>` block, which produced an illegible wall
 * of literal `#`, `**`, `_`, and backtick characters. This module
 * fixes that.
 *
 * Why we don't pull `react-markdown` (or similar):
 *   - The calibration log uses a narrow, templated subset: H1, H2,
 *     bullet lists (with one level of nesting), bold, italic, and
 *     inline code. We control the template — the generator emits a
 *     known shape, so a 50-line targeted parser is more accurate
 *     than a general one and adds zero bundle weight.
 *   - The calibration page is the ONLY consumer today. Adding a
 *     heavy markdown dep for one page is a poor trade.
 *
 * Block parser:
 *   - Skips the leading `# H1` (the page header already shows
 *     "Week YYYY-WW", so duplicating "Calibration log — YYYY-WW"
 *     in the body is noise).
 *   - Extracts the `_Generated TIMESTAMP._` line and exposes it as
 *     `generated_at`. The page header reads this rather than
 *     `fs.statSync().mtime`, because Vercel's build environment
 *     doesn't preserve file mtime — that's why the live site
 *     showed "Generated 2018-10-20 01:46" before this fix.
 *   - Treats `## H2` as section headings.
 *   - Groups consecutive `- item` / `  - item` lines into a
 *     bulleted list with one level of nesting.
 *   - Treats remaining non-empty lines as paragraphs.
 *
 * Inline parser handles `**bold**`, `_italic_`, and `` `code` ``.
 * The order is: code first (its delimiters can contain otherwise-
 * special characters), then bold (longer delimiter), then italic.
 */

import type { ReactNode } from "react";

type Block =
  | { type: "h2"; text: string }
  | { type: "ul"; items: ListItem[] }
  | { type: "p"; inline: string };

type ListItem = {
  inline: string;
  children: { inline: string }[];
};

export interface ParsedCalibrationMarkdown {
  /** The ISO timestamp from the `_Generated TIMESTAMP._` line, or
   * null when the body doesn't include one. The renderer extracts
   * this so the page header can show an accurate time even though
   * Vercel doesn't preserve file mtime. */
  generated_at: string | null;
  blocks: Block[];
}

export function parseCalibrationMarkdown(
  md: string,
): ParsedCalibrationMarkdown {
  const lines = md.split("\n");
  let generated_at: string | null = null;
  const blocks: Block[] = [];
  let leadingH1Seen = false;
  let timestampSeen = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip the leading H1 once.
    if (!leadingH1Seen && line.startsWith("# ")) {
      leadingH1Seen = true;
      i++;
      continue;
    }

    // Extract the `_Generated TIMESTAMP._` line once.
    if (!timestampSeen) {
      const tsMatch = line.match(/^_Generated (.+)\._\s*$/);
      if (tsMatch) {
        generated_at = tsMatch[1];
        timestampSeen = true;
        i++;
        continue;
      }
    }

    // H2.
    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3) });
      i++;
      continue;
    }

    // List (top-level `- ` or nested `  - `).
    if (line.startsWith("- ") || line.startsWith("  - ")) {
      const items: ListItem[] = [];
      let current: ListItem | null = null;
      while (
        i < lines.length &&
        (lines[i].startsWith("- ") || lines[i].startsWith("  - "))
      ) {
        const l = lines[i];
        if (l.startsWith("  - ")) {
          if (current) {
            current.children.push({ inline: l.slice(4) });
          } else {
            // Orphan nested item without parent. Treat as top-level.
            current = { inline: l.slice(4), children: [] };
            items.push(current);
          }
        } else {
          current = { inline: l.slice(2), children: [] };
          items.push(current);
        }
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Paragraph (any other non-empty line).
    if (line.trim() !== "") {
      blocks.push({ type: "p", inline: line });
    }
    i++;
  }

  return { generated_at, blocks };
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(_[^_]+_)/g;

/** Render a single line of markdown-flavored text into JSX nodes.
 * Exported for testing; the component below is the normal entry. */
export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIdx) {
      out.push(text.slice(lastIdx, idx));
    }
    const tok = match[0];
    const key = `${keyPrefix}-${n}`;
    if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-overlay px-1 py-0.5 font-mono text-xs">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key} className="text-strong">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("_")) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    n++;
    lastIdx = idx + tok.length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

/** Render the templated calibration-log markdown as JSX. */
export function CalibrationMarkdown({ md }: { md: string }) {
  const { blocks } = parseCalibrationMarkdown(md);
  return (
    <div className="space-y-5 text-sm leading-relaxed text-default">
      {blocks.map((block, i) => {
        if (block.type === "h2") {
          return (
            <h2
              key={`h2-${i}`}
              className="mt-6 text-base font-semibold text-strong first:mt-0"
            >
              {renderInline(block.text, `h2-${i}`)}
            </h2>
          );
        }
        if (block.type === "p") {
          return (
            <p key={`p-${i}`}>{renderInline(block.inline, `p-${i}`)}</p>
          );
        }
        // ul
        return (
          <ul key={`ul-${i}`} className="ml-5 list-disc space-y-2">
            {block.items.map((item, j) => (
              <li key={`ul-${i}-li-${j}`}>
                {renderInline(item.inline, `ul-${i}-${j}`)}
                {item.children.length > 0 && (
                  <ul className="mt-2 ml-5 list-[circle] space-y-1">
                    {item.children.map((child, k) => (
                      <li key={`ul-${i}-li-${j}-c-${k}`}>
                        {renderInline(child.inline, `ul-${i}-${j}-${k}`)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
