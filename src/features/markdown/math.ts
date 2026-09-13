/// <reference types="micromark-extension-math" />
/// <reference types="remark-parse" />
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Plugin, PluggableList } from "unified";
import type { Root, RootContent } from "mdast";
import type { Code, Construct, State, Tokenizer } from "micromark-util-types";

// Parse LaTeX delimiters at the tokenizer boundary, before Markdown consumes
// backslash escapes. Code spans/fences stay literal and source offsets survive.
const tokenizeLatex: Tokenizer = function (effects, ok, nok) {
  let closing = 41;
  let inData = false;
  const close: Construct = {
    tokenize(closeEffects, done, fail) {
      return slash;
      function slash(code: Code) {
        if (code !== 92) return fail(code);
        closeEffects.enter("mathTextSequence");
        closeEffects.consume(code);
        return end;
      }
      function end(code: Code) {
        if (code !== closing) return fail(code);
        closeEffects.consume(code);
        closeEffects.exit("mathTextSequence");
        return done;
      }
    },
  };
  const finish: State = (code) => {
    effects.exit("mathText");
    return ok(code);
  };
  const endData: State = (code) => {
    if (inData) effects.exit("mathTextData");
    return effects.attempt(close, finish, nok)(code);
  };
  const consume: State = (code) => {
    if (code === null) return nok(code);
    if (!inData) {
      effects.enter("mathTextData");
      inData = true;
    }
    effects.consume(code);
    return data;
  };
  const data: State = (code) => {
    if (code === null) return nok(code);
    if (code === -5 || code === -4 || code === -3) {
      if (inData) effects.exit("mathTextData");
      inData = false;
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return data;
    }
    return code === 92
      ? effects.check(close, endData, consume)(code)
      : consume(code);
  };
  const open: State = (code) => {
    if (code !== 40 && code !== 91) return nok(code);
    closing = code === 40 ? 41 : 93;
    effects.consume(code);
    effects.exit("mathTextSequence");
    return data;
  };
  return (code) => {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    effects.consume(code!);
    return open;
  };
};

const remarkLatex: Plugin<[], Root> = function () {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    text: { 92: { tokenize: tokenizeLatex } },
  });
  return (tree, file) => {
    const source = String(file);
    function visit(node: Root | RootContent) {
      if (
        node.type === "inlineMath" &&
        source.slice(
          node.position?.start.offset,
          (node.position?.start.offset ?? 0) + 2,
        ) === "\\["
      ) {
        node.data!.hProperties = {
          className: ["language-math", "math-display"],
        };
      }
      if ("children" in node) node.children.forEach(visit);
    }
    visit(tree);
  };
};

export const mathRemarkPlugins: PluggableList = [
  remarkGfm,
  remarkMath,
  remarkLatex,
];
export const mathRehypePlugins: PluggableList = [
  [rehypeKatex, { trust: false, maxExpand: 1000 }],
];
