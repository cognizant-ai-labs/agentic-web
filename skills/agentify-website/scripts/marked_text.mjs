// Read the parts of a static HTML page that its owner marked for other agent sites, under
// Node. The build quotes them word for word in the facts network.

/**
 * Reads the text of each element marked data-agent-facts="<topic>" on a hand-written page.
 *
 * A marked part may hold only plain text markup (paragraphs, headings, lists, tables, links
 * and emphasis) with no class, style or hiding attribute, and nothing around it may hide
 * it or make it a form hint. The reader never drops text: anything else is an error. So a
 * quote holds every character of the part, or the build stops.
 *
 * It does not read stylesheets or scripts. A stylesheet can still hide a part through an
 * ancestor's class or a selector that names no class. The skill says to mark only text
 * the page shows.
 */
export class MarkedText {
  /**
   * The attribute that marks a part for callers. Its value is the part's topic.
   */
  static MARK = "data-agent-facts";

  /**
   * One tag, comment or doctype. Quoted attribute values may contain ">".
   */
  static TAG = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;

  /**
   * One attribute in a start tag's attribute text.
   */
  static ATTRIBUTE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  /**
   * Characters a visitor does not see: controls other than white space, format characters
   * (zero-width spaces, bidi controls, tag characters), private-use characters and lone
   * surrogates.
   */
  static INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\p{Cf}\p{Co}\p{Cs}]/u;

  /**
   * Text that makes the runtime add its CRUSE notes when an agent's instructions hold it.
   */
  static CRUSE_MARKER = /GENERATIVE UI \(CRUSE\)/i;

  /**
   * Three backticks. The caller's runtime reads a fenced block in an answer as a form or
   * table (runtime/cruse.js), so a fact must never hold one.
   */
  static FENCE = /```/;

  /**
   * Elements with no end tag.
   */
  static VOID = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  /**
   * Elements whose content the reader skips: raw text, where "<" is not a tag, and SVG or
   * MathML, where "<path/>" closes an element. None of them may be in or around a part.
   */
  static SKIP = new Set([
    "math",
    "script",
    "style",
    "svg",
    "textarea",
    "title",
  ]);

  /**
   * The elements a marked part may hold, each with the attributes it may carry besides id
   * and lang. Any other element or attribute is an error.
   */
  static ALLOWED = new Map([
    ["a", ["href", "rel", "target"]],
    ["abbr", []],
    ["address", []],
    ["b", []],
    ["br", []],
    ["caption", []],
    ["dd", []],
    ["div", []],
    ["dl", []],
    ["dt", []],
    ["em", []],
    ["h1", []],
    ["h2", []],
    ["h3", []],
    ["h4", []],
    ["h5", []],
    ["h6", []],
    ["i", []],
    ["li", []],
    ["ol", ["start"]],
    ["p", []],
    ["section", []],
    ["small", []],
    ["span", []],
    ["strong", []],
    ["sub", []],
    ["sup", []],
    ["table", []],
    ["tbody", []],
    ["td", ["colspan", "rowspan"]],
    ["tfoot", []],
    ["th", ["colspan", "rowspan", "scope"]],
    ["thead", []],
    ["time", ["datetime"]],
    ["tr", []],
    ["ul", []],
  ]);

  /**
   * Allowed elements that run inside a line. Every other allowed element starts and ends one.
   */
  static INLINE = new Set([
    "a",
    "abbr",
    "b",
    "br",
    "em",
    "i",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "td",
    "th",
    "time",
  ]);

  /**
   * Page structure a part may also sit inside. Any element around a part must be one of
   * these or an allowed element, so a form, template, noscript or details is an error.
   */
  static OUTER = new Set([
    "article",
    "aside",
    "body",
    "footer",
    "header",
    "html",
    "main",
    "nav",
  ]);

  /**
   * The attributes an element around a part may carry, besides data-* attributes. A class
   * and data-* are allowed there: pages need them for layout and scripts, and the reader
   * cannot see what a stylesheet does with them.
   */
  static OUTER_ATTRIBUTES = new Set([
    "aria-describedby",
    "aria-label",
    "aria-labelledby",
    "class",
    "dir",
    "id",
    "itemprop",
    "itemscope",
    "itemtype",
    "lang",
    "role",
    "tabindex",
  ]);

  /**
   * Attributes that hide an element by themselves, or keep it out of the page's flow.
   */
  static HIDING_ATTRIBUTES = new Set([
    "aria-hidden",
    "hidden",
    "inert",
    "popover",
    "style",
  ]);

  /**
   * Elements that hide what they hold until a visitor acts, or make it part of a form.
   */
  static HIDING_ELEMENTS = new Set([
    "button",
    "datalist",
    "details",
    "dialog",
    "fieldset",
    "form",
    "iframe",
    "label",
    "legend",
    "noscript",
    "object",
    "optgroup",
    "option",
    "output",
    "select",
    "summary",
    "template",
  ]);

  /**
   * The named character references the reader decodes. Any other name is an error.
   */
  static ENTITIES = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["copy", "©"],
    ["euro", "€"],
    ["gt", ">"],
    ["hellip", "…"],
    ["ldquo", "“"],
    ["lsquo", "‘"],
    ["lt", "<"],
    ["mdash", "—"],
    ["middot", "·"],
    ["nbsp", " "],
    ["ndash", "–"],
    ["pound", "£"],
    ["quot", "\""],
    ["rdquo", "”"],
    ["rsquo", "’"],
    ["times", "×"],
  ]);

  /**
   * Read every marked part of a page, in page order.
   *
   * :param html: The page's HTML.
   * :return: {parts, errors}: each part is {topic, line, lines}; each error is one message.
   */
  static parts(html) {
    const state = {
      html: html,
      tokens: MarkedText.tokens(html),
      // The open elements: {name, attrs, line}.
      stack: [],
      parts: [],
      errors: [],
      // The part being read: {topic, line, start, depth, errors}.
      open: null,
    };
    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (token.kind === "start") {
        MarkedText.startTag(state, index);
      } else if (token.kind === "end" && !MarkedText.endTag(state, index)) {
        // Past a mis-nested end tag the reader cannot tell what holds what.
        return {
          parts: [],
          errors: state.errors,
        };
      }
    }
    if (state.open !== null) {
      state.errors.push(`line ${state.open.line}: the part "${state.open.topic}" is never closed.`);
    }
    return {
      parts: state.parts,
      errors: state.errors,
    };
  }

  /**
   * Say why a piece of facts text could not be published as it is, if it could not.
   *
   * :param text: Text bound for the facts network's instructions.
   * :return: The reason, or null when the text is fine.
   */
  static problemInText(text) {
    const hidden = MarkedText.INVISIBLE.exec(text);
    if (hidden !== null) {
      const code = hidden[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      return `it holds the invisible character U+${code}, which a visitor does not see`;
    }
    if (MarkedText.CRUSE_MARKER.test(text)) {
      return "it holds \"GENERATIVE UI (CRUSE)\", which makes the runtime add its CRUSE notes to every call";
    }
    if (MarkedText.FENCE.test(text)) {
      return "it holds three backticks, which a caller's runtime reads as the start of a form or table";
    }
    return null;
  }

  /**
   * Split HTML into text, start tag and end tag tokens. Comments and doctypes are dropped,
   * and the content of SKIP elements is passed over.
   *
   * :param html: The HTML.
   * :return: The tokens in page order, each with its offset in the page.
   */
  static tokens(html) {
    const lower = html.toLowerCase();
    const pattern = new RegExp(MarkedText.TAG.source, "g");
    const tokens = [];
    let last = 0;
    let match = pattern.exec(html);
    while (match !== null) {
      if (match.index > last) {
        tokens.push({
          kind: "text",
          text: html.slice(last, match.index),
          at: last,
        });
      }
      last = match.index + match[0].length;
      if (match[1] !== undefined) {
        tokens.push({
          kind: "end",
          name: match[1].toLowerCase(),
          at: match.index,
        });
      } else if (match[2] !== undefined) {
        const name = match[2].toLowerCase();
        tokens.push({
          kind: "start",
          name: name,
          attrs: MarkedText.attributes(match[3] || ""),
          selfClosing: match[4] === "/",
          at: match.index,
        });
        if (MarkedText.SKIP.has(name)) {
          const end = lower.indexOf(`</${name}`, last);
          last = end === -1 ? html.length : end;
          pattern.lastIndex = last;
        }
      }
      match = pattern.exec(html);
    }
    if (last < html.length) {
      tokens.push({
        kind: "text",
        text: html.slice(last),
        at: last,
      });
    }
    return tokens;
  }

  /**
   * Parse a start tag's attribute text.
   *
   * :param text: The attribute text, such as ' id="pets" class="note"'.
   * :return: The attributes in order, each {name, value}; value is "" when there is none.
   */
  static attributes(text) {
    const attrs = [];
    for (const match of text.matchAll(MarkedText.ATTRIBUTE)) {
      let value = "";
      if (match[2] !== undefined) {
        value = match[2];
      } else if (match[3] !== undefined) {
        value = match[3];
      } else if (match[4] !== undefined) {
        value = match[4];
      }
      attrs.push({
        name: match[1].toLowerCase(),
        value: value,
      });
    }
    return attrs;
  }

  /**
   * Find an attribute's value.
   *
   * :param attrs: The parsed attributes.
   * :param name: The attribute name, in lower case.
   * :return: Its value, or null when it is absent.
   */
  static value(attrs, name) {
    for (const attr of attrs) {
      if (attr.name === name) {
        return attr.value;
      }
    }
    return null;
  }

  /**
   * Give the line number of an offset in the page.
   *
   * :param html: The page.
   * :param at: The offset.
   * :return: The line number, from 1.
   */
  static lineAt(html, at) {
    return html.slice(0, at).split("\n").length;
  }

  /**
   * Handle a start tag: check it inside a part, open a part at a mark, and track what is open.
   *
   * :param state: The reader's state.
   * :param index: The token's index.
   */
  static startTag(state, index) {
    const token = state.tokens[index];
    const line = MarkedText.lineAt(state.html, token.at);
    const marked = MarkedText.value(token.attrs, MarkedText.MARK) !== null;
    if (state.open !== null && marked) {
      state.errors.push(`line ${line}: a marked part is inside the part "${state.open.topic}". Mark one or the other.`);
    } else if (state.open !== null) {
      MarkedText.checkElement(state, token, false);
    } else if (marked) {
      MarkedText.openPart(state, index);
    }
    if (token.selfClosing && !MarkedText.VOID.has(token.name)) {
      // A browser ignores the "/" and leaves the element open.
      state.errors.push(`line ${line}: <${token.name}/> does not close the element in a browser. Write <${token.name}></${token.name}>.`);
    }
    if (!MarkedText.VOID.has(token.name)) {
      state.stack.push({
        name: token.name,
        attrs: token.attrs,
        line: line,
      });
    }
  }

  /**
   * Handle an end tag: it must close the element opened last. Closing a part's element
   * renders the part.
   *
   * :param state: The reader's state.
   * :param index: The token's index.
   * :return: False when the page is not nested in order, so reading must stop.
   */
  static endTag(state, index) {
    const token = state.tokens[index];
    const top = state.stack.length ? state.stack[state.stack.length - 1] : null;
    if (top === null || top.name !== token.name) {
      const opened = top === null ? "no open element" : `<${top.name}> from line ${top.line}`;
      state.errors.push(`line ${MarkedText.lineAt(state.html, token.at)}: </${token.name}> does not close ${opened}. The build reads only pages where every element is closed in order.`);
      return false;
    }
    state.stack.pop();
    if (state.open !== null && state.stack.length < state.open.depth) {
      MarkedText.closePart(state, index);
    }
    return true;
  }

  /**
   * Start reading a part, after checking its element and every element around it.
   *
   * :param state: The reader's state.
   * :param index: The index of the marked start tag.
   */
  static openPart(state, index) {
    const token = state.tokens[index];
    const topic = MarkedText.value(token.attrs, MarkedText.MARK).trim();
    const line = MarkedText.lineAt(state.html, token.at);
    state.open = {
      topic: topic || "(no topic)",
      line: line,
      start: index,
      depth: state.stack.length + 1,
      errors: state.errors.length,
    };
    if (!topic) {
      state.errors.push(`line ${line}: ${MarkedText.MARK} needs a topic, such as ${MarkedText.MARK}="pets".`);
    }
    for (const outer of state.stack) {
      const problem = MarkedText.outerProblem(outer);
      if (problem !== null) {
        state.errors.push(`line ${line}: the part "${state.open.topic}" is inside ${problem}.`);
      }
    }
    MarkedText.checkElement(state, token, true);
    if (MarkedText.VOID.has(token.name)) {
      // checkElement has refused it: no allowed element is void except <br>.
      state.open = null;
    }
  }

  /**
   * Say what makes an element around a part unsafe to quote from, if anything.
   *
   * :param element: An open element: {name, attrs, line}.
   * :return: A description for the error, or null when the element is fine.
   */
  static outerProblem(element) {
    if (MarkedText.HIDING_ELEMENTS.has(element.name)) {
      return `a <${element.name}> (line ${element.line}), which can hide its content or make it a form hint`;
    }
    if (!MarkedText.ALLOWED.has(element.name) && !MarkedText.OUTER.has(element.name)) {
      return `a <${element.name}> (line ${element.line}), which the build does not read around a part. Mark a part outside it, or give the fact in dataFacts()`;
    }
    for (const attr of element.attrs) {
      if (MarkedText.HIDING_ATTRIBUTES.has(attr.name)) {
        return `a <${element.name}> with ${attr.name} (line ${element.line}), which can hide its content`;
      }
      // A data-* attribute changes nothing a visitor sees unless a stylesheet uses it, as a class can.
      if (!MarkedText.OUTER_ATTRIBUTES.has(attr.name) && !attr.name.startsWith("data-")) {
        return `a <${element.name}> with ${attr.name} (line ${element.line}), which the build does not read around a part. Mark a part outside it, or give the fact in dataFacts()`;
      }
    }
    return null;
  }

  /**
   * Check that an element in a part, or the part's own element, is plain text markup with
   * only the attributes it may carry.
   *
   * :param state: The reader's state.
   * :param token: The start tag.
   * :param isRoot: True for the marked element itself, which also carries the mark.
   */
  static checkElement(state, token, isRoot) {
    const where = `line ${MarkedText.lineAt(state.html, token.at)}: the part "${state.open.topic}"`;
    const allowed = MarkedText.ALLOWED.get(token.name);
    if (allowed === undefined || (isRoot && token.name === "br")) {
      state.errors.push(`${where} holds a <${token.name}>. A marked part may hold only paragraphs, headings, lists, tables, links and emphasis.`);
      return;
    }
    const seen = new Set();
    for (const attr of token.attrs) {
      if (seen.has(attr.name)) {
        state.errors.push(`${where} has a <${token.name}> that repeats ${attr.name}.`);
      }
      seen.add(attr.name);
      if ((isRoot && attr.name === MarkedText.MARK) || attr.name === "id" || attr.name === "lang") {
        continue;
      }
      if (!allowed.includes(attr.name)) {
        state.errors.push(`${where} has a <${token.name}> with ${attr.name}. A marked part may carry only id, lang and the attributes links and table cells need, so the build can tell a visitor sees it.`);
      } else if (attr.name === "href" && !/^(https?:|mailto:|tel:|[^:]*$)/i.test(attr.value.trim())) {
        state.errors.push(`${where} links to "${attr.value}". Use a web, mailto:, tel: or relative link.`);
      }
    }
  }

  /**
   * Finish a part: render its tokens and keep it, unless it had errors.
   *
   * :param state: The reader's state.
   * :param end: The index of the part's end tag.
   */
  static closePart(state, end) {
    const open = state.open;
    state.open = null;
    const lines = MarkedText.render(state, state.tokens.slice(open.start, end + 1), open);
    if (state.errors.length > open.errors) {
      return;
    }
    if (!lines.length) {
      state.errors.push(`line ${open.line}: the part "${open.topic}" holds no text in the HTML. A script may fill it in; give that fact in dataFacts() instead.`);
      return;
    }
    state.parts.push({
      topic: open.topic,
      line: open.line,
      lines: lines,
    });
  }

  /**
   * Turn a part's tokens into lines: one per block, "- " for list items, and table cells
   * joined with " | ".
   *
   * :param state: The reader's state, for errors.
   * :param tokens: The part's tokens, from its start tag to its end tag.
   * :param open: The part: {topic}.
   * :return: The lines, without empty ones.
   */
  static render(state, tokens, open) {
    const out = {
      lines: [],
      line: "",
      prefix: "",
      // Each open link: where its text starts in the line, and its address.
      links: [],
    };
    for (const token of tokens) {
      const block = !MarkedText.INLINE.has(token.name);
      if (token.kind === "text") {
        out.line += MarkedText.decode(state, token, open).replace(/\s+/g, " ");
      } else if (token.kind === "start") {
        if (block || token.name === "br") {
          MarkedText.flush(out);
        }
        if (token.name === "li") {
          out.prefix = "- ";
        } else if ((token.name === "td" || token.name === "th") && out.line.trim()) {
          out.line += " | ";
        } else if (token.name === "a") {
          out.links.push({
            at: out.line.length,
            href: MarkedText.value(token.attrs, "href") || "",
          });
        } else if (token.name === "sup") {
          // Without a mark, a footnote "1" after "$145" would read as "$1451".
          out.line += "^";
        } else if (token.name === "sub") {
          out.line += "_";
        }
      } else if (token.name === "a" && out.links.length) {
        MarkedText.closeLink(out, out.links.pop());
      } else if (block) {
        MarkedText.flush(out);
      }
    }
    MarkedText.flush(out);
    return out.lines;
  }

  /**
   * Write a closed link so its address survives outside the page: a web address as a
   * Markdown link, and an email or phone address after the text when the text lacks it.
   *
   * :param out: The render output.
   * :param link: The link's start in the line and its href.
   */
  static closeLink(out, link) {
    const text = out.line.slice(link.at).trim();
    if (!text) {
      return;
    }
    if (/^https?:\/\//i.test(link.href) && text !== link.href) {
      out.line = `${out.line.slice(0, link.at)}[${text}](${link.href})`;
      return;
    }
    const address = link.href.replace(/^(mailto|tel):/i, "");
    if (/^(mailto|tel):/i.test(link.href) && !text.includes(address)) {
      out.line = `${out.line.slice(0, link.at)}${text} (${address})`;
    }
  }

  /**
   * End the current line, if it has text.
   *
   * :param out: The render output.
   */
  static flush(out) {
    const text = out.line.replace(/\s+/g, " ").trim();
    if (text) {
      out.lines.push(`${out.prefix}${text}`);
    }
    out.line = "";
    out.prefix = "";
    // A link left open across a block boundary starts again in the next line.
    for (const link of out.links) {
      link.at = 0;
    }
  }

  /**
   * Decode a text token's character references and check that a visitor sees all of it.
   *
   * :param state: The reader's state, for errors.
   * :param token: The text token.
   * :param open: The part: {topic}.
   * :return: The decoded text.
   */
  static decode(state, token, open) {
    const where = `line ${MarkedText.lineAt(state.html, token.at)}: the part "${open.topic}"`;
    let out = "";
    let last = 0;
    for (const match of token.text.matchAll(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g)) {
      out += token.text.slice(last, match.index);
      last = match.index + match[0].length;
      const name = match[1];
      const code = name.startsWith("#x") ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      if (name.startsWith("#") && code > 0x10FFFF) {
        state.errors.push(`${where} has the character reference &${name};, which is past the last Unicode character.`);
      } else if (name.startsWith("#")) {
        out += String.fromCodePoint(code);
      } else if (MarkedText.ENTITIES.has(name)) {
        out += MarkedText.ENTITIES.get(name);
      } else {
        state.errors.push(`${where} has the unknown character reference &${name};.`);
      }
    }
    out += token.text.slice(last);
    const problem = MarkedText.problemInText(out);
    if (problem !== null) {
      state.errors.push(`${where}: ${problem}.`);
    }
    return out;
  }
}
