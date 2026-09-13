import type { Element, Root } from "hast";

const blocks = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "li",
  "td",
  "th",
  "hr",
]);

/** Keep Markdown source locations on rendered blocks; raw HTML stays disabled. */
export function attentionPreview() {
  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      if (node.type === "element" && blocks.has(node.tagName)) {
        const from = node.position?.start.offset,
          to = node.position?.end.offset;
        if (from !== undefined && to !== undefined) {
          node.properties["data-study-from"] = from;
          node.properties["data-study-to"] = to;
        }
      }
      for (const child of node.children)
        if (child.type === "element") visit(child);
    };
    visit(tree);
  };
}
