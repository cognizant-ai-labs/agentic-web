// Scripts the linking check evaluates in an agentified page over DevTools.
// Each one is a block whose last expression is its value. They use only the page's own
// elements and the runtime's debug handle, window.__nsweb (runtime/index.js).

/**
 * Builds the page scripts. Values are inserted with JSON.stringify, so any text is safe.
 *
 * No script returns the key: the check reads only whether the page has one.
 */
export class PageScripts {
  /**
   * The runtime has booted and mounted its settings.
   *
   * :return: A script whose value is true when the page is ready.
   */
  static ready() {
    return `typeof window.__nsweb === "object" && !!document.querySelector("#ns-apply");`;
  }

  /**
   * The page runs with this key, after "Apply, save & reload".
   *
   * :param key: The API key.
   * :return: A script whose value is true once the reloaded page has the key.
   */
  static keyApplied(key) {
    return `window.__nsweb?.engine?.byokKey === ${JSON.stringify(key)} && !!document.querySelector("#ns-send");`;
  }

  /**
   * What the engine runs with, without the key itself.
   *
   * :return: A script whose value is a JSON string.
   */
  static engineState() {
    return `{
  const engine = window.__nsweb?.engine;
  JSON.stringify({
    hasKey: !!engine?.byokKey && engine.byokKey !== "demo",
    routerOverride: engine?.routerOverride || "",
    modelOverride: engine?.modelOverride || "",
    topRouter: engine?.top?.llm?.baseUrl || "",
    status: document.querySelector(".ns-action-status summary")?.textContent || "",
  });
}`;
  }

  /**
   * Fill in the BYOK settings as a visitor would, then press "Apply, save & reload".
   *
   * :param key: The API key.
   * :param router: The router base URL.
   * :param model: The model, or "" for none.
   * :return: A script whose value is "applied".
   */
  static applySetup(key, router, model) {
    return `{
  const key = document.querySelector("#ns-key");
  key.value = ${JSON.stringify(key)};
  key.dispatchEvent(new Event("input", { bubbles: true }));
  const router = document.querySelector("#ns-router");
  router.value = ${JSON.stringify(router)};
  router.dispatchEvent(new Event("input", { bubbles: true }));
  const model = document.querySelector("#ns-model");
  model.value = ${JSON.stringify(model)};
  model.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("#ns-apply").click();
  "applied";
}`;
  }

  /**
   * Type a message and press Send.
   *
   * :param message: The visitor's message.
   * :return: A script whose value is "sent".
   */
  static send(message) {
    return `{
  const input = document.querySelector("#ns-input");
  input.value = ${JSON.stringify(message)};
  document.querySelector("#ns-send").click();
  "sent";
}`;
  }

  /**
   * Read what the driver watches: turn state, an open consent card, open dialogs, iframes.
   *
   * :return: A script whose value is a JSON string.
   */
  static poll() {
    return `{
  const state = {
    turn: document.querySelector(".ns-inputbar")?.dataset.turnActive || null,
    consent: null,
    dialogs: [],
    iframes: [],
  };
  const actions = document.querySelector(".ns-consent .ns-consent-actions");
  if (actions) {
    state.consent = actions.closest(".ns-consent").innerText;
  }
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    state.dialogs.push(dialog.innerText);
  }
  for (const frame of document.querySelectorAll("iframe")) {
    state.iframes.push(frame.src);
  }
  JSON.stringify(state);
}`;
  }

  /**
   * The page's iframes with their sandbox attributes.
   *
   * :return: A script whose value is a JSON string.
   */
  static frames() {
    return `{
  const frames = [];
  for (const frame of document.querySelectorAll("iframe")) {
    frames.push({
      src: frame.src,
      sandbox: frame.getAttribute("sandbox"),
      hidden: frame.hidden,
    });
  }
  JSON.stringify(frames);
}`;
  }

  /**
   * Press one button on the open consent card.
   *
   * :param decision: "allow", "always" or "decline".
   * :return: A script whose value is true when a button was pressed.
   */
  static answerConsent(decision) {
    return `{
  let pressed = false;
  for (const button of document.querySelectorAll(".ns-consent .ns-consent-actions button")) {
    if (!pressed && button.dataset.d === ${JSON.stringify(decision)}) {
      button.click();
      pressed = true;
    }
  }
  pressed;
}`;
  }

  /**
   * Press "Cancel" on every open dialog, as a visitor who will not open a popup would.
   *
   * :return: A script whose value is the text of the dialogs it cancelled, as JSON.
   */
  static cancelDialogs() {
    return `{
  const cancelled = [];
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    for (const button of dialog.querySelectorAll("button")) {
      if (button.textContent === "Cancel") {
        cancelled.push(dialog.innerText);
        button.click();
      }
    }
  }
  JSON.stringify(cancelled);
}`;
  }

  /**
   * Collect the chat, the cards, the status line, the agents panel and the trace.
   *
   * :return: A script whose value is a JSON string.
   */
  static collect() {
    return `{
  const out = {
    messages: [],
    cards: document.querySelectorAll("#ns-msgs .ns-consent").length,
    actionStatus: document.querySelector(".ns-action-status summary")?.textContent || "",
    // The status line's detail, which stays hidden until the visitor opens it.
    actionStatusDetail: document.querySelector(".ns-action-status p")?.textContent || "",
    agents: document.querySelector("#ns-anodes")?.innerText || "",
    iframes: [],
    trace: window.__nsweb?.trace?.events || [],
  };
  for (const message of document.querySelectorAll("#ns-msgs .ns-msg")) {
    out.messages.push({
      cls: message.className,
      text: message.innerText,
    });
  }
  for (const frame of document.querySelectorAll("iframe")) {
    out.iframes.push(frame.src);
  }
  JSON.stringify(out);
}`;
  }

  /**
   * The keyless read check of "Check without a key" (references/bundle_and_hosting.md):
   * run the first read action in agentTools that needs no arguments, through the page's
   * registry. It runs only actions whose effect is "read".
   *
   * :param agentTools: The manifest's actions.agentTools.
   * :return: A script whose value is a JSON string with the registered names, the action
   *   it ran, the receipt's status and the status line.
   */
  static readCheck(agentTools) {
    return `{
  const { engine } = window.__nsweb;
  const scope = {
    base: engine.top.base,
    network: engine.top.network.name,
  };
  const names = ${JSON.stringify(agentTools)};
  const out = {
    registered: [],
    action: null,
    status: null,
    summary: document.querySelector(".ns-action-status summary")?.textContent || "",
  };
  let chosen = null;
  for (const entry of engine.actions.catalog(scope)) {
    out.registered.push(entry.name);
    if (chosen === null && names.includes(entry.name) && entry.effect === "read" && !(entry.inputSchema?.required || []).length) {
      chosen = entry;
    }
  }
  if (chosen !== null) {
    const plan = engine.actions.prepare({
      kind: "action",
      action: chosen.ref,
      arguments: {},
    });
    const receipts = await engine.actions.execute(plan, Boolean, "console-check");
    out.action = chosen.name;
    out.status = receipts?.[0]?.status || null;
  }
  JSON.stringify(out);
}`;
  }

  /**
   * The text of the page body, for a page without the assistant.
   *
   * :return: A script whose value is the body's text.
   */
  static bodyText() {
    return `document.body ? document.body.innerText : "";`;
  }
}
