import { Fragment, type ReactNode } from "react";

/**
 * Tiny, dependency-free renderer for the small subset of Markdown used in
 * this app's content strings (verdicts, rationale, cumulative-finding
 * narrative, report bodies): **bold**, `inline code`, blank-line-separated
 * paragraphs, and `- ` / `* ` bullet lists. This is what fixes the
 * literal-`**bold**`-in-HTML bug everywhere those strings are rendered.
 *
 * Deliberately NOT a general Markdown engine — no links, headings, tables,
 * nested lists. If a string needs more than this, the content should change,
 * not this renderer.
 */

/** Parses `**bold**` and `` `code` `` within one line/inline run into React nodes. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on **bold** and `code` spans, keeping the delimiters via capture groups.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(pattern);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      nodes.push(<strong key={i}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      nodes.push(<code key={i}>{part.slice(1, -1)}</code>);
    } else {
      nodes.push(<Fragment key={i}>{part}</Fragment>);
    }
  });
  return nodes;
}

interface Block {
  type: "p" | "ul";
  lines: string[];
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const rawLines = source.split("\n");
  let current: Block | null = null;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (line === "") {
      current = null;
      continue;
    }
    const isBullet = /^[-*]\s+/.test(line);
    const kind: Block["type"] = isBullet ? "ul" : "p";
    const content = isBullet ? line.replace(/^[-*]\s+/, "") : line;

    if (current && current.type === kind) {
      current.lines.push(content);
    } else {
      current = { type: kind, lines: [content] };
      blocks.push(current);
    }
  }
  return blocks;
}

export function Markdown({ text, testId }: { text: string; testId?: string }) {
  const blocks = parseBlocks(text ?? "");
  return (
    <div className="md" data-testid={testId}>
      {blocks.map((block, i) =>
        block.type === "ul" ? (
          <ul key={i}>
            {block.lines.map((line, j) => (
              <li key={j}>{renderInline(line)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{renderInline(block.lines.join(" "))}</p>
        ),
      )}
    </div>
  );
}
