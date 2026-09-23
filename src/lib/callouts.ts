import type { Blockquote, Paragraph, PhrasingContent, Root, RootContent } from "mdast";

// Obsidian callouts: a blockquote whose first line is `[!type] Title`
// (optionally `[!type]+` / `[!type]-` to make it foldable, open/collapsed).
// A remark plugin rather than a string rewrite, so everything inside a
// callout — lists, tables, math, nested callouts — is parsed as ordinary
// markdown first. It only re-labels the mdast nodes' HTML output (via
// data.hName/hProperties, which mdast-util-to-hast honors), producing:
//
//   <div class="callout" data-callout="warning">        (or <details>)
//     <div class="callout-title" data-callout="warning">  (or <summary>)
//     <div class="callout-content">…</div>
//   </div>
//
// NoteMarkdown then adds the icon, and globals.css the per-type colors.

export const CALLOUT_TYPES = [
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

// Obsidian's documented aliases — each shares its canonical type's styling.
const ALIASES: Record<string, CalloutType> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

// Unknown types fall back to "note" styling, as in Obsidian — the title
// still shows the type as written.
export function canonicalCalloutType(raw: string): CalloutType {
  const t = raw.toLowerCase();
  if ((CALLOUT_TYPES as readonly string[]).includes(t)) return t as CalloutType;
  return ALIASES[t] ?? "note";
}

const HEADER_RE = /^\[!([^\]\s]+)\]([+-])?[ \t]*/;

export interface CalloutHeader {
  type: CalloutType;
  rawType: string;
  fold: "+" | "-" | null;
}

export function parseCalloutHeader(firstLine: string): (CalloutHeader & { length: number }) | null {
  const m = HEADER_RE.exec(firstLine);
  if (!m) return null;
  return { type: canonicalCalloutType(m[1]), rawType: m[1], fold: (m[2] as "+" | "-") ?? null, length: m[0].length };
}

function defaultTitle(rawType: string): string {
  return rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
}

// Splits the first paragraph's inline content at the end of its first line:
// the header line's remainder becomes the title, the rest the body. Handles
// both a raw "\n" inside a text node and a `break` node (what remark-breaks
// turns such newlines into, if it ran first).
function splitFirstLine(children: PhrasingContent[]): { title: PhrasingContent[]; rest: PhrasingContent[] } {
  const title: PhrasingContent[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "break") return { title, rest: children.slice(i + 1) };
    if (child.type === "text") {
      const nl = child.value.indexOf("\n");
      if (nl !== -1) {
        const before = child.value.slice(0, nl);
        const after = child.value.slice(nl + 1);
        if (before) title.push({ ...child, value: before });
        const rest = children.slice(i + 1);
        return { title, rest: after ? [{ ...child, value: after }, ...rest] : rest };
      }
    }
    title.push(child);
  }
  return { title, rest: [] };
}

function isBlank(nodes: PhrasingContent[]): boolean {
  return nodes.every((n) => n.type === "text" && n.value.trim() === "");
}

function transformBlockquote(node: Blockquote): boolean {
  const first = node.children[0];
  if (!first || first.type !== "paragraph") return false;
  const lead = first.children[0];
  if (!lead || lead.type !== "text") return false;
  const header = parseCalloutHeader(lead.value);
  if (!header) return false;

  const afterMarker = lead.value.slice(header.length);
  const inline: PhrasingContent[] = afterMarker ? [{ ...lead, value: afterMarker }] : [];
  const { title, rest } = splitFirstLine([...inline, ...first.children.slice(1)]);
  const foldable = header.fold !== null;

  const titleNode: Paragraph = {
    type: "paragraph",
    children: isBlank(title) ? [{ type: "text", value: defaultTitle(header.rawType) }] : title,
    data: {
      hName: foldable ? "summary" : "div",
      hProperties: { className: ["callout-title"], dataCallout: header.type },
    },
  };

  const body: RootContent[] = [];
  if (!isBlank(rest)) body.push({ type: "paragraph", children: rest });
  body.push(...node.children.slice(1));

  const children: Blockquote["children"] = [titleNode];
  if (body.length > 0) {
    children.push({
      // Any block container works here — hName makes it a plain <div>.
      type: "blockquote",
      children: body as Blockquote["children"],
      data: { hName: "div", hProperties: { className: ["callout-content"] }, callout: true },
    } as Blockquote);
  }

  node.children = children;
  node.data = {
    ...node.data,
    hName: foldable ? "details" : "div",
    hProperties: {
      className: ["callout"],
      dataCallout: header.type,
      ...(header.fold === "+" ? { open: true } : {}),
    },
    callout: true,
  } as Blockquote["data"];
  return true;
}

declare module "mdast" {
  interface BlockquoteData {
    // Set on nodes this plugin already produced, so the content wrapper
    // (itself a blockquote node) isn't mistaken for another callout.
    callout?: boolean;
  }
}

function walk(node: Root | RootContent) {
  if (node.type === "blockquote" && !node.data?.callout) transformBlockquote(node);
  if ("children" in node) for (const child of node.children) walk(child as RootContent);
}

export default function remarkCallouts() {
  return (tree: Root) => walk(tree);
}
