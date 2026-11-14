// Checks the facts network that other agent sites call, from the skill's
// templates/tests/facts.test.mjs.
// Run from the repository root (Node 22 does not accept a bare folder):
//   node --test "<site folder>/tests/*.test.mjs"
// The build writes facts/ from agent-facts.mjs, and its --check says whether facts/ is up
// to date. These tests check what the facts say, that they hold nobody's details, and what
// a caller's run sends.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { AgentFacts } from "../agent-facts.mjs";
import { ActionRegistry } from "../runtime/actions.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";
import { runAgent } from "../runtime/runner.js";
import { TraceBus } from "../runtime/trace.js";
import { ScriptedModel } from "./scripted_model.mjs";
import { TourData } from "../js/tour-data.js";

/**
 * Checks for the site's facts network.
 *
 * The facts must say what the site's data and pages say, hold nobody's details, carry
 * their date, and reach a caller's model as one call with no tools and no runtime notes.
 */
class CallerFactsTest {
  /**
   * The facts network's name: the site's network name plus "_facts".
   */
  static NAME = "marrow_point_harbor_tours_facts";

  /**
   * The site's name, as the facts network's rules give it.
   */
  static SITE_NAME = "Marrow Point Harbor Tours";

  /**
   * The site's seed records: bookings, orders, reservations or accounts, such as
   * GuesthouseData.EXISTING_BOOKINGS. Leave it empty only with NO_PRIVATE_RECORDS.
   */
  static RECORDS = TourData.EXISTING_RESERVATIONS;

  /**
   * The fields of a record that name a person or a booking, such as
   * ["code", "firstName", "lastName", "email", "phone"].
   */
  static RECORD_FIELDS = [
    "code",
    "firstName",
    "lastName",
  ];

  /**
   * When RECORDS is empty, say why the site keeps no records about visitors, such as
   * "The site takes no bookings and keeps no visitor data." The check then relies on the
   * pattern scan alone.
   */
  static NO_PRIVATE_RECORDS = "";

  /**
   * The site's own phone numbers and email addresses, as its pages show them. Any other
   * number or address in the facts fails the test.
   */
  static SITE_CONTACTS = [
    "555-0162",
    "harbortours@example.com",
  ];

  /**
   * Words in the facts that match a record or look like a code for another reason, such
   * as a month that is also a first name. Keep this short.
   */
  static NOT_PRIVATE = [];

  /**
   * A few facts callers ask about most, word for word from the pages or data.
   */
  static PINNED = [
    "Seal Rocks Cruise: 90 minutes on the Kittiwake. 12 places. Runs every day at 10 am and 2 pm.",
    "The Twilight Sail is for ages 12 and over",
    "Cancelling is free.",
  ];

  /**
   * Page text that must stay out of the facts, such as a demo note.
   */
  static PAGE_ONLY = [
    "Demo site: reservations are simulated",
    "Tidewhistle Guesthouse",
  ];

  /**
   * Read the facts network, its manifest and the site's manifest.
   *
   * :return: The config, the AgentNetwork, its front agent's spec and both manifests.
   */
  static async load() {
    const config = JSON.parse(await readFile(new URL(`../facts/${CallerFactsTest.NAME}.network.json`, import.meta.url), "utf8"));
    const network = new AgentNetwork(config, CallerFactsTest.NAME);
    return {
      config: config,
      network: network,
      spec: network.getAgentSpec(network.findFrontMan()),
      factsManifest: JSON.parse(await readFile(new URL("../facts/agent-manifest.json", import.meta.url), "utf8")),
      manifest: JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8")),
    };
  }

  /**
   * The facts network is valid and dated, has one agent with no tools and no CRUSE, calls
   * no one, loads no site code, and the site's manifest points callers to it.
   */
  static async testFactsNetworkIsToolFree() {
    const loaded = await CallerFactsTest.load();
    assert.deepEqual(validateNetwork(loaded.network).errors, []);
    assert.equal(loaded.config.tools.length, 1);
    assert.deepEqual(loaded.spec.tools, []);
    assert.equal(loaded.network.config.cruse, undefined);
    assert.equal(loaded.network.config.commondefs, undefined);
    // No actions and no coded tools: callers load no bridge and run none of this site's code.
    assert.equal(loaded.factsManifest.actions, undefined);
    assert.equal(loaded.factsManifest.coded_tools, undefined);
    assert.deepEqual(loaded.factsManifest.allowed_peers, []);
    assert.equal(loaded.factsManifest.peer_policy.mode, "closed");
    assert.equal(loaded.factsManifest.networks[0].name, CallerFactsTest.NAME);
    const asOf = loaded.config.metadata.facts_as_of;
    assert.match(asOf, /^\d{4}-\d{2}-\d{2}$/);
    const instructions = loaded.spec.instructions;
    assert.ok(instructions.includes("when another website's assistant asks for its visitor"));
    assert.ok(instructions.includes(`PUBLIC FACTS (${CallerFactsTest.SITE_NAME}, as of ${asOf})`));
    assert.ok(instructions.includes("Do not add up a total"));
    let exported = false;
    for (const entry of loaded.manifest.linking.exports) {
      if (entry.network === CallerFactsTest.NAME && entry.url === `facts/${CallerFactsTest.NAME}`) {
        exported = true;
      }
    }
    assert.ok(exported, "linking.exports does not point callers to the facts network.");
  }

  /**
   * The facts hold every line agent-facts.mjs gives now and the pinned facts, and leave out
   * page-only text. A stale or empty facts file fails.
   */
  static async testFactsMatchTheSite() {
    const instructions = (await CallerFactsTest.load()).spec.instructions;
    assert.ok(CallerFactsTest.PINNED.length > 0, "Pin a few facts callers ask about most in PINNED.");
    if (typeof AgentFacts.dataFacts === "function") {
      for (const topic of AgentFacts.dataFacts()) {
        for (const line of topic.lines) {
          assert.ok(instructions.includes(`- ${line.replace(/\s+/g, " ").trim()}`), `The facts lack "${line}". Run the build again.`);
        }
      }
    }
    for (const phrase of CallerFactsTest.PINNED) {
      assert.ok(instructions.includes(phrase), `The facts lack "${phrase}".`);
    }
    for (const phrase of CallerFactsTest.PAGE_ONLY) {
      assert.ok(!instructions.includes(phrase), `The facts hold the page-only text "${phrase}".`);
    }
  }

  /**
   * Nothing in facts/ names a person or a booking: no seed record's fields, no email or
   * phone number but the site's own, nothing shaped like a code or a key, and no link with
   * a query string. Every file there is checked, because callers can fetch each one.
   */
  static async testFactsHoldNoPrivateDetails() {
    const text = await CallerFactsTest.factsText();
    const problems = [];
    if (!CallerFactsTest.RECORDS.length && !CallerFactsTest.NO_PRIVATE_RECORDS.trim()) {
      problems.push("RECORDS is empty and NO_PRIVATE_RECORDS gives no reason. List the site's seed records, or say why it keeps none.");
    }
    if (CallerFactsTest.RECORDS.length && !CallerFactsTest.RECORD_FIELDS.length) {
      problems.push("RECORD_FIELDS is empty. Name the fields that identify a person or a booking.");
    }
    CallerFactsTest.findRecords(text, problems);
    CallerFactsTest.findPatterns(text, problems);
    // The JSON text and the plain instructions can show the same problem twice.
    assert.deepEqual(Array.from(new Set(problems)), []);
  }

  /**
   * Read every file in facts/, plus the instructions as plain text.
   *
   * :return: The text to scan.
   */
  static async factsText() {
    const folder = new URL("../facts/", import.meta.url);
    const names = (await readdir(folder)).sort();
    const parts = [];
    for (const name of names) {
      // The build records a sha256 of each source in metadata.facts_sources, so a check
      // after upload can compare. A hash is not a fact and never reaches a model, and its
      // hex digits would look like a phone number or a key, so it is left out of the scan.
      const file = await readFile(new URL(name, folder), "utf8");
      parts.push(file.replace(/"sha256": "[0-9a-f]{64}"/g, "\"sha256\": \"\""));
    }
    // JSON escapes quotes and line breaks, so the instructions are scanned unescaped too.
    parts.push((await CallerFactsTest.load()).spec.instructions);
    return parts.join("\n");
  }

  /**
   * Add a problem for each record field the facts show.
   *
   * :param text: The facts text.
   * :param problems: The problems found so far, which this adds to.
   */
  static findRecords(text, problems) {
    for (const record of CallerFactsTest.RECORDS) {
      for (const field of CallerFactsTest.RECORD_FIELDS) {
        const raw = record[field];
        const value = raw === undefined || raw === null ? "" : String(raw).trim();
        if (value.length < 2) {
          problems.push(`A record has no ${field}. RECORD_FIELDS must name fields that every record has.`);
          continue;
        }
        if (!CallerFactsTest.isAllowed(value) && CallerFactsTest.wordPattern(value).test(text)) {
          problems.push(`The facts show the ${field} "${value}" from a record.`);
        }
      }
    }
  }

  /**
   * Add a problem for each email, phone number, code, key or tracked link in the facts
   * that is not the site's own.
   *
   * :param text: The facts text.
   * :param problems: The problems found so far, which this adds to.
   */
  static findPatterns(text, problems) {
    const emails = new Set();
    const phones = new Set();
    for (const contact of CallerFactsTest.SITE_CONTACTS) {
      if (contact.includes("@")) {
        emails.add(contact.toLowerCase());
      } else {
        phones.add(contact.replace(/\D/g, ""));
      }
    }
    for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      if (!emails.has(match[0].toLowerCase())) {
        problems.push(`The facts show the email address ${match[0]}, which is not in SITE_CONTACTS.`);
      }
    }
    for (const match of text.matchAll(/\+?\(?\d[\d ().-]{5,}\d/g)) {
      const found = match[0].trim();
      const digits = found.replace(/\D/g, "");
      // Seven or more digits make a phone number. A date, or a range of two times or two
      // dates, is not one, and NOT_PRIVATE can clear any other number.
      if (digits.length >= 7 && !CallerFactsTest.isDateOrRange(found) && !phones.has(digits) && !CallerFactsTest.isAllowed(found)) {
        problems.push(`The facts show the number ${found}, which is not in SITE_CONTACTS.`);
      }
    }
    const shapes = [
      /\b[A-Z]{1,4}-(?=[A-Z0-9]*\d)[A-Z0-9]{3,}\b/g,
      /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b/g,
      /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
      /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g,
      /https?:\/\/[^\s)\]"]+\?[^\s)\]"]+/g,
    ];
    for (const shape of shapes) {
      for (const match of text.matchAll(shape)) {
        if (!CallerFactsTest.isAllowed(match[0])) {
          problems.push(`The facts show "${match[0]}", which looks like a code, a key or a tracked link.`);
        }
      }
    }
  }

  /**
   * Say whether a number is an ISO date, or two times or two ISO dates joined by " - ",
   * such as "9.30 - 17.30" or "2026-11-01 - 2027-03-31".
   *
   * :param text: The number as the facts show it.
   * :return: True when it is a date or a range, not a phone number.
   */
  static isDateOrRange(text) {
    return /^(\d{4}-\d{2}-\d{2}|\d{1,2}[.:]\d{2} - \d{1,2}[.:]\d{2}|\d{4}-\d{2}-\d{2} - \d{4}-\d{2}-\d{2})$/.test(text);
  }

  /**
   * Say whether a value is in NOT_PRIVATE.
   *
   * :param value: The value.
   * :return: True when the site says it is not private.
   */
  static isAllowed(value) {
    for (const word of CallerFactsTest.NOT_PRIVATE) {
      if (word.toLowerCase() === value.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Build a case-insensitive pattern that finds a value as a whole word.
   *
   * :param value: The value, such as a last name or a code.
   * :return: The pattern.
   */
  static wordPattern(value) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
  }

  /**
   * Run as another site runs it, the facts network makes one model call with only its
   * instructions and the request: no tools, no CRUSE context and no actions note.
   *
   * :param t: The test context from node:test.
   */
  static async testCallerRunIsOneCall(t) {
    const loaded = await CallerFactsTest.load();
    const model = new ScriptedModel([
      {
        text: "The facts say so.",
      },
    ]);
    const ctx = {
      network: loaded.network,
      manifest: loaded.factsManifest,
      actions: new ActionRegistry(),
      baseOrigin: "http://127.0.0.1:8080/facts",
      displayOrigin: "127.0.0.1:8080",
      trace: new TraceBus(),
      isTop: false,
      frontMan: loaded.network.findFrontMan(),
      history: [],
      llm: model,
      maxSteps: 12,
    };
    const result = await runAgent(ctx, ctx.frontMan, "What do you offer?", null, []);
    assert.equal(result.text, "The facts say so.");
    assert.equal(model.calls.length, 1);
    assert.deepEqual(model.calls[0].tools, []);
    const system = model.calls[0].messages[0].content;
    assert.equal(system, loaded.spec.instructions.trim());
    // The request reaches the facts agent as the only other message, word for word.
    assert.deepEqual(model.calls[0].messages.slice(1), [
      {
        role: "user",
        content: "What do you offer?",
      },
    ]);
    assert.ok(!system.includes("CRUSE invocation context"));
    assert.ok(!system.includes("No browser actions are registered"));
    t.diagnostic(`A caller's run sends ${system.length} characters of system prompt and no tool definitions.`);
  }
}

test("the facts network is valid, dated, tool-free and exported", CallerFactsTest.testFactsNetworkIsToolFree);
test("the facts say what the site's data and pages say", CallerFactsTest.testFactsMatchTheSite);
test("the facts hold nobody's details", CallerFactsTest.testFactsHoldNoPrivateDetails);
test("a caller's run is one model call with the facts alone", CallerFactsTest.testCallerRunIsOneCall);
