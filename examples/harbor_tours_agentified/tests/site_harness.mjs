// Shared setup and helpers for this site's tests. Each test file imports this module.
// node --test runs each file in its own process, so each file gets its own page.
// These tests use the real runtime and the real page code, with a scripted model.
// They do not call an LLM provider.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ActionRegistry } from "../runtime/actions.js";
import { AgentNetwork } from "../runtime/kernel.js";
import { buildToolTable, dispatchToolCall } from "../runtime/runner.js";
import { TraceBus } from "../runtime/trace.js";
import { Calendar } from "../js/calendar.js";
import { TourData } from "../js/tour-data.js";
import { StubDocument } from "./stub_document.mjs";
import { StubElement } from "./stub_element.mjs";
import { StubOption } from "./stub_option.mjs";

// The site uses today's date. Pin it before the page loads, with the site's own hook,
// so tests with fixed dates pass on any day. 2026-11-11 is a Wednesday.
Calendar.fixedToday = "2026-11-11";

// The page's address in these tests: the site is opened as http://localhost:8081/.
// site.js gives its own dialog only to actions from the page's origin.
const BASE = "http://localhost:8081";
const PAGE_HTML = await readFile(new URL("../index.html", import.meta.url), "utf8");

// Page scripts touch the DOM when they load, so give them a stand-in first.
// It knows the ids in index.html, so a mistyped id fails instead of passing silently.
globalThis.document = StubDocument.fromHtml(PAGE_HTML, `${BASE}/`);
// The page builds its ticket options with new Option(text, value).
globalThis.Option = StubOption;
const { registerActions } = await import("../site-actions.js");
// site.js boots the runtime only in a browser. Here it gives the dialog's words.
const { AssistantMount } = await import("../site.js");
const { App } = await import("../js/app.js");

/**
 * Builds the runtime objects the browser would build, and drives the page the way its
 * own buttons and forms do, for every test file of this site.
 *
 * All tests in one file share one page and run in order, as in one browser tab.
 */
export class SiteHarness {
  /** The network name, which is also the .hocon file name. */
  static NETWORK_NAME = "marrow_point_harbor_tours";

  /** The page's address in the tests. */
  static BASE = BASE;

  /** The text of index.html. */
  static PAGE_HTML = PAGE_HTML;

  /** The site's registerActions export. */
  static registerActions = registerActions;

  /** The AssistantMount class from site.js. */
  static AssistantMount = AssistantMount;

  /** The App class from js/app.js, which keeps the running page. */
  static App = App;

  /** The actions the runtime's own dialog was asked about, newest last. */
  static runtimeReviews = [];

  /**
   * Read the published network and manifest.
   *
   * :return: An object with config, manifest and network.
   */
  static async load() {
    const config = JSON.parse(await readFile(new URL(`../${SiteHarness.NETWORK_NAME}.network.json`, import.meta.url), "utf8"));
    const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
    return {
      config: config,
      manifest: manifest,
      network: new AgentNetwork(config, SiteHarness.NETWORK_NAME),
    };
  }

  /**
   * Return the scope the site's actions are registered under.
   *
   * :return: The base and network name.
   */
  static scope() {
    return {
      base: BASE,
      network: SiteHarness.NETWORK_NAME,
    };
  }

  /**
   * Create a registry with the site's actions registered.
   *
   * :return: The action registry, once every action is registered.
   */
  static async registry() {
    const registry = new ActionRegistry();
    await registerActions({
      register: registry.register.bind(registry, SiteHarness.scope()),
    });
    return registry;
  }

  /**
   * Build the runner context the engine would pass to runAgent.
   *
   * :param loaded: The result of load().
   * :param registry: The action registry.
   * :param model: The scripted model.
   * :param confirm: The confirmation callback, or undefined to leave it out.
   * :return: The runner context.
   */
  static context(loaded, registry, model, confirm) {
    return {
      network: loaded.network,
      manifest: loaded.manifest,
      actions: registry,
      baseOrigin: BASE,
      displayOrigin: new URL(BASE).host,
      trace: new TraceBus(),
      isTop: true,
      frontMan: loaded.network.findFrontMan(),
      history: [],
      llm: model,
      confirmWebsiteActions: confirm,
    };
  }

  /**
   * Find the front agent's tool for a website action.
   *
   * :param loaded: The result of load().
   * :param ctx: The runner context from context().
   * :param name: The action name, without "website_".
   * :return: The tool entry, or undefined when the front agent is not offered it.
   */
  static async tool(loaded, ctx, name) {
    const spec = loaded.network.getAgentSpec(loaded.network.findFrontMan());
    const table = await buildToolTable(ctx, spec, [], null);
    return table.toolByName.get(`website_${name}`);
  }

  /**
   * Call a website tool the way the model does, through the front agent's tool table.
   *
   * :param name: The action name, without "website_".
   * :param args: The arguments the model sends.
   * :param confirm: The confirmation callback; approve() when left out.
   * :return: The receipt, or a rejected promise for arguments the runtime refuses.
   */
  static async call(name, args, confirm = SiteHarness.approve) {
    const loaded = await SiteHarness.load();
    const registry = await SiteHarness.registry();
    const ctx = SiteHarness.context(loaded, registry, null, confirm);
    const entry = await SiteHarness.tool(loaded, ctx, name);
    assert.ok(entry, `The front agent is not offered website_${name}.`);
    return dispatchToolCall(ctx, entry, args, null, []);
  }

  /**
   * Call a website tool and return its result, failing unless the call succeeded.
   *
   * :param name: The action name, without "website_".
   * :param args: The arguments the model sends.
   * :return: What the action returned.
   */
  static async result(name, args) {
    const receipt = await SiteHarness.call(name, args);
    assert.equal(receipt.status, "succeeded", JSON.stringify(receipt));
    return receipt.result;
  }

  /**
   * Read the page state through the read action.
   *
   * :return: The page state.
   */
  static async state() {
    return SiteHarness.result("get_tours_state", {});
  }

  /**
   * Run the read action directly and return its result.
   *
   * :param registry: The action registry.
   * :return: The page state.
   */
  static async readState(registry) {
    const plan = registry.prepare({
      kind: "action",
      action: SiteHarness.ref(registry, "get_tours_state"),
      arguments: {},
    });
    const receipts = await registry.execute(plan, SiteHarness.approve, "test-read");
    return receipts[0].result;
  }

  /**
   * Find an action's reference by name.
   *
   * :param registry: The action registry.
   * :param name: The action name.
   * :return: The action reference.
   * :raises Error: When no action with that name is registered.
   */
  static ref(registry, name) {
    for (const entry of registry.catalog(SiteHarness.scope())) {
      if (entry.name === name) {
        return entry.ref;
      }
    }
    throw new Error(`Action ${name} is not registered.`);
  }

  /**
   * Approve every confirmation.
   *
   * :return: True.
   */
  static async approve() {
    return true;
  }

  /**
   * Decline every confirmation, as a visitor pressing the decline button would.
   *
   * :return: False.
   */
  static async decline() {
    return false;
  }

  /**
   * Stand in for the runtime's own dialog: note the actions and decline them.
   *
   * :param items: The actions waiting for confirmation.
   * :return: False.
   */
  static async recordRuntimeReview(items) {
    SiteHarness.runtimeReviews.push(items);
    return false;
  }

  /**
   * Open the dialog through review() and press the button with this label, or Escape
   * when the label is null. First check that focus starts on the title, which Enter
   * cannot activate.
   *
   * :param item: The action waiting for confirmation.
   * :param label: The button's label, or null for Escape.
   * :return: A promise of the answer review() gives.
   * :raises Error: When the dialog has no button with that label.
   */
  static answerDialog(item, label) {
    const answer = AssistantMount.review([item]);
    const dialog = document.body.children.at(-1);
    assert.equal(dialog?.open, true, "review() did not open the dialog in site.js.");
    const title = dialog.children[0];
    assert.equal(title.textContent, AssistantMount.DIALOGS[item.action].title);
    assert.equal(title.autofocus, true);
    assert.equal(title.tabIndex, -1);
    if (label === null) {
      // Escape fires "cancel", then closes the dialog with no return value.
      dialog.pressEscape();
      return answer;
    }
    for (const button of dialog.querySelectorAll("button")) {
      if (button.textContent === label) {
        button.dispatch("click");
        return answer;
      }
    }
    throw new Error(`The dialog has no "${label}" button.`);
  }

  /**
   * Give a stand-in for the chat input, which only the runtime adds. review() and
   * consent() put focus back there.
   *
   * :return: The stand-in.
   */
  static chatInput() {
    const input = new StubElement("textarea");
    document.provide("#ns-input", [input]);
    return input;
  }

  /**
   * Forget which page elements were focused, so a test can see what one call focuses.
   */
  static clearFocus() {
    for (const element of document.elements.values()) {
      element.focused = false;
    }
  }

  /**
   * List the page elements that page code focused since clearFocus().
   *
   * :return: Their ids.
   */
  static focusedIds() {
    const ids = [];
    for (const [id, element] of document.elements) {
      if (element.focused) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Find the tag name of each id in index.html, so a test can say which are form controls.
   *
   * :return: A map from id to tag name.
   */
  static tags() {
    const tags = new Map();
    for (const match of PAGE_HTML.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*?\sid="([^"]+)"/gi)) {
      tags.set(match[2], match[1].toLowerCase());
    }
    return tags;
  }

  /**
   * Let the page's showErrors() run on the stand-ins for one form. The stand-ins have no
   * after() or matches(), and cannot search for ".field-error", so this gives the form's
   * fields those two methods and gives the search the messages they insert.
   *
   * :param prefix: The form's id prefix, such as "reserve".
   * :return: The list that receives each message the page inserts.
   */
  static equipErrors(prefix) {
    const inserted = [];
    const tags = SiteHarness.tags();
    for (const id of document.knownIds) {
      if (id.startsWith(`${prefix}-`)) {
        const field = document.getElementById(id);
        field.after = SiteHarness.placeAfter.bind(null, field, inserted);
        field.matches = SiteHarness.isFormControl.bind(null, tags.get(id));
      }
    }
    document.provide(`.field-error[id^="${prefix}-"]`, inserted);
    return inserted;
  }

  /**
   * Stand in for field.after(message): note the message and the field before it.
   *
   * :param field: The field the message goes after.
   * :param inserted: The list of inserted messages.
   * :param node: The message.
   */
  static placeAfter(field, inserted, node) {
    node.previousElementSibling = field;
    inserted.push(node);
  }

  /**
   * Stand in for field.matches("input, select, textarea").
   *
   * :param tag: The field's tag name in index.html.
   * :param selector: The selector the page code uses.
   * :return: True for a form control.
   * :raises Error: For any other selector, which this stand-in cannot match.
   */
  static isFormControl(tag, selector) {
    if (selector !== "input, select, textarea") {
      throw new Error(`The test cannot match "${selector}".`);
    }
    return tag === "input" || tag === "select" || tag === "textarea";
  }

  /**
   * Fill the page's reservation form, as a visitor typing would, and record its fields
   * so the page can reset the form.
   *
   * :param contact: firstName, lastName, email, phone and notes.
   */
  static fillReserveForm(contact) {
    const form = document.getElementById("reserve-form");
    form.elements = {};
    for (const name of ["firstName", "lastName", "email", "phone", "notes"]) {
      const field = document.getElementById(`reserve-${name}`);
      field.value = contact[name] === undefined ? "" : contact[name];
      form.elements[name] = field;
    }
  }

  /**
   * Read the page's reservation form fields.
   *
   * :return: Each field's value by name.
   */
  static reserveFormValues() {
    const values = {};
    for (const name of ["firstName", "lastName", "email", "phone", "notes"]) {
      values[name] = document.getElementById(`reserve-${name}`).value;
    }
    return values;
  }

  /**
   * Search with the page's own find form.
   *
   * :param date: The date as "YYYY-MM-DD".
   * :param adults: Adult tickets.
   * :param children: Child tickets.
   * :param under4s: Tickets for children under 4.
   */
  static searchOnPage(date, adults, children, under4s) {
    document.getElementById("find-date").value = date;
    document.getElementById("find-adults").value = String(adults);
    document.getElementById("find-children").value = String(children);
    document.getElementById("find-under4s").value = String(under4s);
    document.getElementById("find-form").dispatch("submit");
  }

  /**
   * Find the button with a label inside one element of the page.
   *
   * :param element: The element to look in.
   * :param label: The button's text.
   * :return: The buttons with that label, in page order.
   */
  static buttons(element, label) {
    const found = [];
    for (const button of element.querySelectorAll("button")) {
      if (button.textContent === label) {
        found.push(button);
      }
    }
    return found;
  }

  /**
   * Press the "Add to basket" button of one departure in the page's results list.
   *
   * :param heading: The departure's heading, such as "2 pm · Seal Rocks Cruise".
   * :raises Error: When the list has no such departure with an Add button.
   */
  static addOnPage(heading) {
    for (const item of document.getElementById("departure-list").children) {
      if (item.children[0].textContent === heading) {
        const found = SiteHarness.buttons(item, "Add to basket");
        assert.equal(found.length, 1, `${heading} has no Add to basket button.`);
        found[0].dispatch("click");
        return;
      }
    }
    throw new Error(`The results list has no ${heading}.`);
  }

  /**
   * Read the text of each item in a list on the page, one line per item.
   *
   * :param id: The list's id.
   * :return: Each item's text, its children's texts joined with " | ".
   */
  static listText(id) {
    const lines = [];
    for (const item of document.getElementById(id).children) {
      const parts = [];
      if (item.textContent) {
        parts.push(item.textContent);
      }
      for (const child of item.children) {
        parts.push(child.textContent);
      }
      lines.push(parts.join(" | "));
    }
    return lines;
  }

  /**
   * List every string of other visitors' reservations: codes and names.
   *
   * :return: The strings.
   */
  static otherPeoplesStrings() {
    const strings = [];
    for (const record of TourData.EXISTING_RESERVATIONS) {
      strings.push(record.code, record.firstName, record.lastName);
    }
    return strings;
  }

  /**
   * Fail when a value the model or the visitor gets holds a string from another
   * visitor's reservation, other than those the caller showed it was entitled to.
   *
   * :param value: Any JSON value, such as a tool result or dialog content.
   * :param allowed: Strings that may appear, such as the looked-up reservation's own code.
   */
  static assertNoOtherRecords(value, allowed = []) {
    const text = JSON.stringify(value);
    for (const secret of SiteHarness.otherPeoplesStrings()) {
      if (!allowed.includes(secret)) {
        assert.ok(!text.includes(secret), `"${secret}" from another visitor's reservation leaked: ${text.slice(0, 300)}`);
      }
    }
  }

  /**
   * Return a reservation as stored by the trip book, found by its code.
   *
   * :param code: The reservation code.
   * :return: A copy of the stored record, or null.
   */
  static stored(code) {
    for (const reservation of App.page.book.reservations) {
      if (reservation.code === code) {
        return JSON.parse(JSON.stringify(reservation));
      }
    }
    return null;
  }

  /**
   * Copy every stored reservation, for before-and-after comparisons.
   *
   * :return: The records.
   */
  static allStored() {
    return JSON.parse(JSON.stringify(App.page.book.reservations));
  }

  /**
   * Empty the basket through the page's own Remove buttons.
   */
  static emptyBasketOnPage() {
    let removed = true;
    while (removed) {
      removed = false;
      const buttons = SiteHarness.buttons(document.getElementById("reserve-basket"), "Remove");
      if (buttons.length) {
        buttons[0].dispatch("click");
        removed = true;
      }
    }
  }
}
