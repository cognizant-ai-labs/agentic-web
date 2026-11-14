// Checks skills/agentify-website/scripts/facts_check.mjs, the facts-network checks of
// check_partner.mjs, with a stand-in for the running check and its fetch.
// Run from the repository root: node --test "tests/skills/agentify-website/scripts/*.test.mjs"
// check_partner.test.mjs runs the same checks end to end on a served site.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FactsCheck } from "../../../../skills/agentify-website/scripts/facts_check.mjs";
import { MarkedText } from "../../../../skills/agentify-website/scripts/marked_text.mjs";
import { AgentNetwork } from "../../../../skills/agentify-website/runtime/kernel.js";

/**
 * Runs FactsCheck's methods on a stand-in check whose fetch answers from a table.
 *
 * The check after upload compares the live site with the hashes the build recorded, so
 * these tests give it a page as built, and then as a host might rewrite it.
 */
class FactsCheckTest {
  /**
   * The facts folder of the stand-in site.
   */
  static FOLDER = "https://desk.example/facts";

  /**
   * The page the stand-in site serves, as the build quoted it.
   */
  static PAGE = "<main><p data-agent-facts=\"contact\">Call 555-0199 or email desk@example.com.</p></main>";

  /**
   * Answer a stand-in request from a table of path -> text.
   *
   * :param files: The table.
   * :param url: The requested URL.
   * :return: What PartnerCheck.get gives: the response and its text, or 404.
   */
  static async fakeGet(files, url) {
    const urlPath = new URL(url).pathname;
    if (!Object.hasOwn(files, urlPath)) {
      return {
        response: {
          status: 404,
        },
        text: "",
      };
    }
    return {
      response: {
        status: 200,
      },
      text: files[urlPath],
    };
  }

  /**
   * Keep one printed line.
   *
   * :param lines: The list to add to.
   * :param line: The line.
   */
  static record(lines, line) {
    lines.push(line);
  }

  /**
   * Make a stand-in for the running PartnerCheck.
   *
   * :param origin: The --origin value, or null for the site's own check.
   * :param files: The live site's files, by path.
   * :return: The stand-in, with its printed lines.
   */
  static check(origin, files) {
    const printed = [];
    return {
      options: {
        origin: origin,
      },
      today: "2026-12-02",
      warnings: [],
      errors: [],
      printed: printed,
      print: FactsCheckTest.record.bind(null, printed),
      get: FactsCheckTest.fakeGet.bind(null, files),
    };
  }

  /**
   * Make a facts network whose metadata records the given sources.
   *
   * :param sources: metadata.facts_sources, or undefined for none.
   * :return: The AgentNetwork.
   */
  static network(sources) {
    return new AgentNetwork({
      metadata: {
        facts_as_of: "2026-11-12",
        facts_sources: sources,
      },
      max_steps: 2,
      tools: [
        {
          name: "facts_assistant",
          instructions: "You answer for Seaside Desk when another website's assistant asks for its visitor.",
          tools: [],
        },
      ],
    }, "desk_facts");
  }

  /**
   * The sources the build would record for PAGE and one data file.
   *
   * :param data: The data file's text.
   * :return: metadata.facts_sources.
   */
  static sources(data) {
    const part = MarkedText.parts(FactsCheckTest.PAGE).parts[0];
    return {
      site: "../",
      pages: [
        {
          page: "index.html",
          topic: "contact",
          sha256: createHash("sha256").update(part.lines.join("\n"), "utf8").digest("hex"),
        },
      ],
      data: [
        {
          file: "js/data.js",
          sha256: createHash("sha256").update(data, "utf8").digest("hex"),
        },
      ],
    };
  }

  /**
   * The URL parts check_partner.mjs passes, for the stand-in facts URL.
   *
   * :return: The target.
   */
  static target() {
    return {
      origin: "https://desk.example",
      folder: FactsCheckTest.FOLDER,
    };
  }

  /**
   * The live site as built matches: only the reformatting a browser ignores is allowed.
   */
  static async testMatchingSitePasses() {
    const files = {
      "/index.html": FactsCheckTest.PAGE.replace("<p ", "\n  <p "),
      "/js/data.js": "export const OPEN = true;\n",
    };
    const check = FactsCheckTest.check(null, files);
    await FactsCheck.checkSources(check, FactsCheckTest.network(FactsCheckTest.sources("export const OPEN = true;\n")), FactsCheckTest.target());
    assert.deepEqual(check.errors, []);
    assert.deepEqual(check.printed, ["Compared with the live site: 1 quoted page parts and 1 data files match the facts."]);
  }

  /**
   * A host that hides email addresses changes the quoted text, and shows as a change.
   */
  static async testHostRewriteShowsAsChange() {
    const files = {
      "/index.html": FactsCheckTest.PAGE.replace("desk@example.com", "desk [at] example.com"),
      "/js/data.js": "export const OPEN = true;\n",
    };
    const check = FactsCheckTest.check(null, files);
    await FactsCheck.checkSources(check, FactsCheckTest.network(FactsCheckTest.sources("export const OPEN = true;\n")), FactsCheckTest.target());
    assert.equal(check.errors.length, 1);
    assert.ok(check.errors[0].startsWith("The facts are out of date with the live site: index.html: the part \"contact\" reads differently now."), check.errors[0]);
  }

  /**
   * A part marked since the build, and a part no longer marked, are both changes.
   */
  static async testMarksAddedOrRemoved() {
    const files = {
      "/index.html": "<main><p data-agent-facts=\"hours\">Open 9 to 5.</p></main>",
      "/js/data.js": "export const OPEN = true;\n",
    };
    const check = FactsCheckTest.check(null, files);
    await FactsCheck.checkSources(check, FactsCheckTest.network(FactsCheckTest.sources("export const OPEN = true;\n")), FactsCheckTest.target());
    assert.ok(check.errors[0].startsWith("The facts are out of date with the live site: index.html no longer marks the part \"contact\"; index.html marks a new part \"hours\"."), check.errors[0]);
  }

  /**
   * With no sources recorded, the check prints a note; with --origin it compares nothing,
   * because a caller cannot fix a partner's files.
   */
  static async testNoSourcesAndCallerMode() {
    const own = FactsCheckTest.check(null, {});
    await FactsCheck.checkSources(own, FactsCheckTest.network(undefined), FactsCheckTest.target());
    assert.deepEqual(own.printed, ["The facts network lists no sources, so this check cannot compare its facts with the live site."]);
    const caller = FactsCheckTest.check("http://localhost:8082", {});
    await FactsCheck.checkSources(caller, FactsCheckTest.network(FactsCheckTest.sources("x")), FactsCheckTest.target());
    assert.deepEqual(caller.printed, []);
    assert.deepEqual(caller.errors, []);
  }

  /**
   * The age line counts days, and the date check refuses dates that do not exist.
   */
  static testDates() {
    assert.equal(FactsCheck.daysBetween("2026-11-12", "2026-12-02"), 20);
    assert.equal(FactsCheck.ageText(0), "today");
    assert.equal(FactsCheck.ageText(1), "1 day ago");
    assert.equal(FactsCheck.ageText(20), "20 days ago");
    assert.equal(FactsCheck.ageText(-1), "a date after today");
    assert.equal(FactsCheck.isDate("2028-02-29"), true);
    assert.equal(FactsCheck.isDate("2027-02-29"), false);
    assert.equal(FactsCheck.isDate("2026-11-12T00:00"), false);
  }
}

test("a live site that matches the facts passes", FactsCheckTest.testMatchingSitePasses);
test("a host that rewrites the page shows as a change", FactsCheckTest.testHostRewriteShowsAsChange);
test("added and removed marks show as changes", FactsCheckTest.testMarksAddedOrRemoved);
test("no sources gives a note, and caller mode compares nothing", FactsCheckTest.testNoSourcesAndCallerMode);
test("dates and ages", FactsCheckTest.testDates);
