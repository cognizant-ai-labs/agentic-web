// Optional: offers this site's actions to the visitor's own browser agent through WebMCP.
//
// WebMCP is a draft browser API (W3C Web Machine Learning Community Group). A page
// registers tools with modelContext.registerTool(), and an agent built into the browser,
// or a browser extension, can call them instead of clicking through the page. Only
// Chromium browsers have it, behind origin trials, so this file does nothing where
// modelContext is missing, and the site and its own assistant work as before.
//
// It registers the same actions site-actions.js gives the site's assistant, with the same
// names, descriptions, schemas and code. The runtime's rules carry over:
//   - "read" actions get readOnlyHint and run at once;
//   - "write" actions run at once, as they do for the site's own assistant;
//   - "irreversible" actions get consequentialHint and run only after the visitor confirms
//     in this page's own dialog. WebMCP leaves confirmation to the calling agent, which
//     this site cannot trust, so the page asks itself. Without a confirm function they are
//     not offered at all.
// Arguments are checked against each action's inputSchema with the runtime's validator
// before execute runs, and a refusal or a thrown error is returned as a tool error.
//
// Load it from site.js after the runtime boots (see references/webmcp.md):
//   import { SiteWebMCP } from "./webmcp.js";
//   SiteWebMCP.register({ confirm: AssistantMount.review });
import { registerActions } from "./site-actions.js";
import { validateData } from "./runtime/actions.js";

/**
 * Registers the site's actions with WebMCP when the browser has it.
 */
export class SiteWebMCP {
  /**
   * The modelContext object: the draft spec's document.modelContext, or the
   * navigator.modelContext that Chrome's trial builds use.
   *
   * :return: The object, or null when the browser has no WebMCP.
   */
  static context() {
    return globalThis.document?.modelContext || globalThis.navigator?.modelContext || null;
  }

  /**
   * Collect the site's action definitions, as the runtime would receive them.
   *
   * :return: The definitions the page registers for its own assistant.
   */
  static definitions() {
    const definitions = [];
    registerActions({ register: (definition) => definitions.push(definition) });
    // A bridge-only action belongs to partner sites, not to this page.
    return definitions.filter((d) => d.availability !== "bridge");
  }

  /**
   * Wrap a result as WebMCP tool content: one JSON text block.
   *
   * :param value: The action's result.
   * :param isError: Whether the call failed or was refused.
   * :return: {content: [{type: "text", text}], isError?}.
   */
  static content(value, isError = false) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return { content: [{ type: "text", text }], ...(isError && { isError: true }) };
  }

  /**
   * Run one action for a browser agent: validate, confirm if irreversible, execute.
   *
   * :param definition: The site's action definition.
   * :param input: The browser agent's arguments.
   * :param confirm: The page's confirmation function, or null.
   * :return: The tool content.
   */
  static async run(definition, input, confirm) {
    const args = input && typeof input === "object" ? input : {};
    try {
      validateData(definition.inputSchema || { type: "object" }, args);
    } catch (error) {
      return SiteWebMCP.content(`Nothing ran: ${error.message}`, true);
    }
    if (definition.effect === "irreversible") {
      const item = { action: definition.name, origin: globalThis.location?.origin || "", effect: definition.effect, arguments: args };
      let confirmed = false;
      try {
        confirmed = await confirm([item]);
      } catch (error) {
        return SiteWebMCP.content(`Nothing ran: ${error.message}`, true);
      }
      if (!confirmed) {
        return SiteWebMCP.content("Nothing ran: the visitor declined on the page.", true);
      }
    }
    try {
      const result = await definition.execute(args);
      return SiteWebMCP.content(result, Boolean(result && result.ok === false));
    } catch (error) {
      // As in the runtime: a thrown error after execute started is an unknown outcome.
      return SiteWebMCP.content(`Unknown outcome: ${error.message}. Ask the visitor to check the page before trying again.`, true);
    }
  }

  /**
   * The WebMCP tool for one action definition.
   *
   * :param definition: The site's action definition.
   * :param confirm: The page's confirmation function, or null.
   * :return: The tool.
   */
  static tool(definition, confirm) {
    const annotations = {};
    if (definition.effect === "read") {
      annotations.readOnlyHint = true;
    }
    if (definition.effect === "irreversible") {
      annotations.consequentialHint = true;
    }
    return {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema || { type: "object", properties: {} },
      annotations,
      execute: (input) => SiteWebMCP.run(definition, input, confirm),
    };
  }

  /**
   * Register the site's actions with WebMCP.
   *
   * :param options: {confirm}: the page's confirmation function, such as
   *   AssistantMount.review from site.js. Without it, irreversible actions are not offered.
   * :return: The names registered, or [] when the browser has no WebMCP.
   */
  static register({ confirm = null } = {}) {
    const mc = SiteWebMCP.context();
    if (!mc) {
      return [];
    }
    const tools = SiteWebMCP.definitions()
      .filter((d) => d.effect !== "irreversible" || typeof confirm === "function")
      .map((d) => SiteWebMCP.tool(d, confirm));
    try {
      if (typeof mc.registerTool === "function") {
        for (const tool of tools) {
          mc.registerTool(tool);
        }
      } else if (typeof mc.provideContext === "function") {
        mc.provideContext({ tools });
      } else {
        return [];
      }
    } catch (error) {
      // The page works without WebMCP.
      console.warn("WebMCP registration failed", error);
      return [];
    }
    return tools.map((t) => t.name);
  }
}
