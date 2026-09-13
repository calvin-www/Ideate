import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import {
  mathRemarkPlugins,
  mathRehypePlugins,
} from "../src/features/markdown/math";
import { attentionPreview } from "../src/features/notes/attentionPreview";

function render(source: string) {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: mathRemarkPlugins,
      rehypePlugins: mathRehypePlugins,
      children: source,
    }),
  );
}
describe("workspace math rendering", () => {
  it("preserves original note offsets after LaTeX so later attention cues stay aligned", () => {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, {
        remarkPlugins: mathRemarkPlugins,
        rehypePlugins: [attentionPreview, ...mathRehypePlugins],
        children: "\\(x\\)\n\nAfter",
      }),
    );
    expect(html).toContain('data-study-from="7" data-study-to="12"');
    expect(html).toContain('class="katex"');
  });

  it("renders dollar and LaTeX delimiters as accessible inline and display math", () => {
    const html = render(String.raw`Inline $x^2$ and \(\frac{a}{b}\).

$$
\sum_{i=1}^n i
$$

\[
\sqrt{x}
\]`);
    expect(html.match(/class="katex"/g)).toHaveLength(4);
    expect(html.match(/class="katex-display"/g)).toHaveLength(2);
    expect(html).toContain("<math");
  });
  it("leaves literal code and escaped delimiters alone, and survives incomplete math", () => {
    const html = render(
      "`$x$` and `\\(x\\)`\n\n```python\nprint('$x$')\n```\n\n\\\\(literal) and \\(unfinished",
    );
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("<code>$x$</code>");
    expect(render("$\\unknowncommand{x}$")).toContain("unknowncommand");
  });
});
