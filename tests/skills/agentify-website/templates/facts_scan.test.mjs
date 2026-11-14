// Checks the privacy scan in skills/agentify-website/templates/tests/facts.test.mjs: it must
// fail on a planted private detail in the facts, and pass on true facts that only look
// private. Each case copies the guesthouse example, plants one thing, rebuilds and runs
// the example's own facts test, which is the template filled in.
// Run from the repository root: node --test "tests/**/*.test.mjs"
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Plants private details in copies of the guesthouse and runs its facts test on each.
 *
 * The guesthouse keeps seed bookings, so its test scans for their fields as well as for
 * emails, phone numbers, codes, keys and tracked links that are not the site's own.
 */
class FactsScanTest {
  /**
   * The repository root.
   */
  static REPO = fileURLToPath(new URL("../../../../", import.meta.url));

  /**
   * The example the cases copy.
   */
  static SITE = path.join(FactsScanTest.REPO, "examples", "guesthouse_agentified");

  /**
   * The sentence in a marked page part after which page plants go.
   */
  static ABOUT = "two minutes' walk from the ferry slip.";

  /**
   * The line in agent-facts.mjs before which data plants go.
   */
  static RETURN = "    return [\n";

  /**
   * Each case: what it plants, the edits as [file, old, new], and whether the facts test
   * must fail.
   */
  static CASES = [
    {
      what: "a guest's email in lower case in a dataFacts() line",
      edits: [["agent-facts.mjs", FactsScanTest.RETURN, "    lines.push(\"Harbor View Room is held for marisol.vega@example.net.\");\n    return [\n"]],
      caught: true,
    },
    {
      what: "a seed booking's code and name in a dataFacts() line",
      edits: [["agent-facts.mjs", FactsScanTest.RETURN, "    lines.push(\"Harbor View Room is held by booking TW-7KQ2 for Iris Pell.\");\n    return [\n"]],
      caught: true,
    },
    {
      what: "RECORDS emptied with no NO_PRIVATE_RECORDS reason",
      edits: [["tests/facts.test.mjs", "static RECORDS = GuesthouseData.EXISTING_BOOKINGS;", "static RECORDS = [];"]],
      caught: true,
    },
    {
      what: "a visitor's review with an email and a phone number in a marked part",
      edits: [["index.html", FactsScanTest.ABOUT, `${FactsScanTest.ABOUT} "Lovely breakfast!" Iris, iris.pell@example.net, +1 (415) 555-0199.`]],
      caught: true,
    },
    {
      what: "a code-like token in a marked part",
      edits: [["index.html", FactsScanTest.ABOUT, `${FactsScanTest.ABOUT} Your order code is TW-9XZ4.`]],
      caught: true,
    },
    {
      what: "a link with a query string in a marked part",
      edits: [["index.html", FactsScanTest.ABOUT, `${FactsScanTest.ABOUT} <a href="https://tables.example.com/book?ref=abc123">Book a table</a>.`]],
      caught: true,
    },
    {
      what: "a key-shaped token in a marked part",
      edits: [["index.html", FactsScanTest.ABOUT, `${FactsScanTest.ABOUT} Router key sk-test-not-a-real-key.`]],
      caught: true,
    },
    {
      what: "another business's phone number in a marked part",
      edits: [["index.html", FactsScanTest.ABOUT, `${FactsScanTest.ABOUT} For boat trips, call 555-0162.`]],
      caught: true,
    },
    {
      what: "opening hours as a range of two times",
      edits: [["index.html", FactsScanTest.ABOUT, `${FactsScanTest.ABOUT} Breakfast 7.30 - 10.30 daily.`]],
      caught: false,
    },
    {
      what: "a season as a range of two ISO dates",
      edits: [["index.html", FactsScanTest.ABOUT, `${FactsScanTest.ABOUT} Low season 2026-11-01 - 2027-03-31.`]],
      caught: false,
    },
    {
      what: "another business's number that NOT_PRIVATE clears",
      edits: [
        ["index.html", FactsScanTest.ABOUT, `${FactsScanTest.ABOUT} For boat trips, call 555-0162.`],
        ["tests/facts.test.mjs", "static NOT_PRIVATE = [];", "static NOT_PRIVATE = [\"555-0162\"];"],
      ],
      caught: false,
    },
  ];

  /**
   * Replace one text in a copy's file. It must be there exactly once.
   *
   * :param folder: The copy.
   * :param file: The file, relative to the copy.
   * :param from: The text to replace.
   * :param to: The new text.
   */
  static async edit(folder, file, from, to) {
    const target = path.join(folder, file);
    const text = await readFile(target, "utf8");
    assert.equal(text.split(from).length, 2, `${file}: ${JSON.stringify(from)} is not there exactly once.`);
    await writeFile(target, text.replace(from, to));
  }

  /**
   * Copy the guesthouse, apply a case's edits, rebuild it and run its facts test.
   *
   * :param item: The case.
   * :return: The build's and the test's exit codes and output.
   */
  static async runCase(item) {
    const folder = await mkdtemp(path.join(os.tmpdir(), "facts-scan-"));
    try {
      await cp(FactsScanTest.SITE, folder, { recursive: true });
      for (const [file, from, to] of item.edits) {
        await FactsScanTest.edit(folder, file, from, to);
      }
      const built = spawnSync(process.execPath, [
        path.join(FactsScanTest.REPO, "skills", "agentify-website", "scripts", "build_network.mjs"),
        path.join(folder, "tidewhistle_guesthouse.hocon"),
        "--manifest",
        path.join(folder, "agent-manifest.json"),
        "--today",
        "2026-11-12",
      ], { encoding: "utf8" });
      // A test runner's child gets NODE_TEST_CONTEXT, which would make the nested run
      // report to this one and exit 0, so the nested run gets an environment without it.
      const env = Object.assign({}, process.env);
      delete env.NODE_TEST_CONTEXT;
      const tested = spawnSync(process.execPath, ["--test", path.join(folder, "tests", "facts.test.mjs")], {
        encoding: "utf8",
        env: env,
      });
      return {
        buildCode: built.status,
        buildOut: built.stdout,
        testCode: tested.status,
        testOut: tested.stdout,
      };
    } finally {
      await rm(folder, {
        recursive: true,
        force: true,
      });
    }
  }

  /**
   * Each planted detail fails the facts test, and each true fact that only looks private
   * passes it.
   */
  static async testScanCatchesPlants() {
    for (const item of FactsScanTest.CASES) {
      const result = await FactsScanTest.runCase(item);
      assert.equal(result.buildCode, 0, `${item.what}: ${result.buildOut}`);
      if (item.caught) {
        assert.notEqual(result.testCode, 0, `${item.what}: the facts test passed.`);
      } else {
        assert.equal(result.testCode, 0, `${item.what}: ${result.testOut}`);
      }
    }
  }
}

test("the template's facts test fails on planted private details and passes true facts", FactsScanTest.testScanCatchesPlants);
