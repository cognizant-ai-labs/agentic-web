// Checks the facts network that skills/agentify-website/scripts/build_network.mjs writes from
// a site's agent-facts.mjs (scripts/facts_network.mjs).
// Run from the repository root: node --test "tests/skills/agentify-website/scripts/*.test.mjs"
// Each test copies fixtures/facts_site to a temp folder, changes one thing and runs the real
// build with the skill's runtime and a fixed --today. Nothing is fetched and no model is called.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Builds copies of a small site with facts and checks the facts network and every facts
 * message the build prints.
 *
 * The date rule matters most: "as of" is the day the facts last changed, so --check on
 * any later day passes, and only a change to the pages or data fails it.
 */
class FactsNetworkTest {
  /**
   * The skill folder.
   */
  static SKILL = fileURLToPath(new URL("../../../../skills/agentify-website/", import.meta.url));

  /**
   * The fixture site that each test copies.
   */
  static FIXTURE = fileURLToPath(new URL("./fixtures/facts_site/", import.meta.url));

  /**
   * The day the first build dates the facts.
   */
  static FIRST_DAY = "2026-11-12";

  /**
   * A later day, for builds that should keep the first date.
   */
  static LATER_DAY = "2030-01-01";

  /**
   * The facts network file, relative to the site.
   */
  static NETWORK_FILE = path.join("facts", "seaside_desk_facts.network.json");

  /**
   * Copy the fixture site to a new temp folder.
   *
   * :return: The temp folder.
   */
  static async copyFixture() {
    const folder = await mkdtemp(path.join(os.tmpdir(), "facts-site-"));
    await cp(FactsNetworkTest.FIXTURE, folder, { recursive: true });
    return folder;
  }

  /**
   * Delete a temp folder.
   *
   * :param folder: The folder to delete.
   */
  static async remove(folder) {
    await rm(folder, {
      recursive: true,
      force: true,
    });
  }

  /**
   * Run build_network.mjs on a site copy with the skill's runtime.
   *
   * :param folder: The site copy.
   * :param today: The --today date.
   * :param extra: More arguments, such as ["--check"].
   * :param env: Extra environment variables for the build, or null.
   * :return: The exit code and the printed output.
   */
  static build(folder, today, extra, env) {
    const args = [
      path.join(FactsNetworkTest.SKILL, "scripts", "build_network.mjs"),
      path.join(folder, "seaside_desk.hocon"),
      "--manifest",
      path.join(folder, "agent-manifest.json"),
      "--runtime",
      path.join(FactsNetworkTest.SKILL, "runtime"),
      "--today",
      today,
    ];
    for (const arg of extra) {
      args.push(arg);
    }
    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      env: Object.assign({}, process.env, env || {}),
    });
    return {
      code: result.status,
      out: `${result.stdout}${result.stderr}`,
    };
  }

  /**
   * Build a copy and require it to pass.
   *
   * :param folder: The site copy.
   * :param today: The --today date.
   * :return: The output.
   */
  static buildOk(folder, today) {
    const result = FactsNetworkTest.build(folder, today, [], null);
    assert.equal(result.code, 0, result.out);
    return result.out;
  }

  /**
   * Return the WARNING and ERROR lines of a build's output, in order.
   *
   * :param output: The printed output.
   * :return: The lines.
   */
  static findings(output) {
    const found = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("WARNING: ") || line.startsWith("ERROR: ")) {
        found.push(line);
      }
    }
    return found;
  }

  /**
   * Read the facts network a build wrote.
   *
   * :param folder: The site copy.
   * :return: Its text and its parsed config.
   */
  static async readFacts(folder) {
    const text = await readFile(path.join(folder, FactsNetworkTest.NETWORK_FILE), "utf8");
    return {
      text: text,
      config: JSON.parse(text),
    };
  }

  /**
   * Replace text in one of the copy's files. The text must be there.
   *
   * :param folder: The site copy.
   * :param file: The file, relative to the site.
   * :param from: The text to replace.
   * :param to: The new text.
   */
  static async edit(folder, file, from, to) {
    const target = path.join(folder, file);
    const text = await readFile(target, "utf8");
    assert.ok(text.includes(from), `${file} has no ${JSON.stringify(from)}.`);
    await writeFile(target, text.replaceAll(from, to));
  }

  /**
   * Write a site file.
   *
   * :param folder: The site copy.
   * :param file: The file, relative to the site.
   * :param text: Its text.
   */
  static async write(folder, file, text) {
    const target = path.join(folder, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }

  /**
   * Replace agent-facts.mjs with one whose dataFacts() returns the given lines.
   *
   * :param folder: The site copy.
   * :param lines: The lines, as JavaScript source.
   */
  static async writeDataFacts(folder, lines) {
    await FactsNetworkTest.write(folder, "agent-facts.mjs", [
      "export class AgentFacts {",
      "  static PAGES = [\"index.html\"];",
      "  static dataFacts() {",
      `    return [{title: "Notes", source: "js/desk-data.js", lines: [${lines}]}];`,
      "  }",
      "}",
      "",
    ].join("\n"));
  }

  /**
   * The facts network has one tool-free agent with the dated facts, no cruse block and no
   * commondefs, and a closed manifest with no actions. The report names its size, and
   * --check on a later day keeps the date.
   */
  static async testFilesAndShape() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      const out = FactsNetworkTest.buildOk(folder, FactsNetworkTest.FIRST_DAY);
      assert.match(out, /Facts network: facts\/seaside_desk_facts \(one agent, no tools, no bridge\): \d+ instruction chars, 8 fact lines, as of 2026-11-12/);
      const facts = await FactsNetworkTest.readFacts(folder);
      const config = facts.config;
      assert.equal(config.tools.length, 1);
      assert.equal(config.tools[0].name, "facts_assistant");
      assert.deepEqual(config.tools[0].tools, []);
      assert.equal(config.max_steps, 2);
      assert.equal(config.cruse, undefined);
      assert.equal(config.commondefs, undefined);
      assert.equal(config.llm_config.model_name, "gpt-4.1-mini");
      assert.equal(config.metadata.facts_as_of, "2026-11-12");
      const instructions = config.tools[0].instructions;
      assert.ok(instructions.includes("PUBLIC FACTS (Seaside Desk, as of 2026-11-12):"));
      assert.ok(instructions.includes("For dates after 2027-11-12, say they may have changed by then."));
      assert.ok(instructions.includes("## Opening hours (js/desk-data.js)\n- Monday to Friday: open 9 am to 5 pm."));
      assert.ok(instructions.includes("## contact (index.html)\nContact\nCall 555-0199 or email desk@example.com."));
      assert.ok(instructions.includes("## dogs (policies.html)\nDogs\n- Dogs on a lead are welcome."));
      assert.ok(!instructions.includes("Demo site"), "An unmarked note was quoted.");
      const manifest = JSON.parse(await readFile(path.join(folder, "facts", "agent-manifest.json"), "utf8"));
      assert.equal(manifest.actions, undefined);
      assert.deepEqual(manifest.allowed_peers, []);
      assert.equal(manifest.peer_policy.mode, "closed");
      assert.deepEqual(manifest.networks[0].tags, ["agentified-website", "public-facts"]);
      const links = JSON.parse(await readFile(path.join(folder, "facts", "links.json"), "utf8"));
      assert.deepEqual(links, {
        version: 1,
        networks: {
          seaside_desk_facts: {},
        },
      });
      const checked = FactsNetworkTest.build(folder, FactsNetworkTest.LATER_DAY, ["--check"], null);
      assert.equal(checked.code, 0, checked.out);
      assert.match(checked.out, /as of 2026-11-12/);
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }

  /**
   * The build records each marked part and each imported file, with a hash, so a check
   * after upload can compare them with the live site.
   */
  static async testSourcesAreRecorded() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      FactsNetworkTest.buildOk(folder, FactsNetworkTest.FIRST_DAY);
      const sources = (await FactsNetworkTest.readFacts(folder)).config.metadata.facts_sources;
      assert.equal(sources.site, "../");
      const parts = [];
      for (const item of sources.pages) {
        parts.push(`${item.page}#${item.topic}`);
        assert.match(item.sha256, /^[0-9a-f]{64}$/);
      }
      assert.deepEqual(parts, ["index.html#about", "index.html#contact", "policies.html#dogs"]);
      const files = [];
      for (const item of sources.data) {
        files.push(item.file);
        assert.match(item.sha256, /^[0-9a-f]{64}$/);
      }
      assert.deepEqual(files, ["agent-facts.mjs", "js/desk-data.js", "js/desk-facts.js"]);
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }

  /**
   * A changed fact fails --check, with the facts message. A rebuild then moves the date,
   * and an unchanged rebuild writes the same bytes.
   */
  static async testChangesFailCheckAndMoveTheDate() {
    const cases = [
      ["js/desk-data.js", "close: \"5 pm\"", "close: \"6 pm\""],
      ["policies.html", "Dogs on a lead are welcome.", "Dogs on a short lead are welcome."],
    ];
    for (const [file, from, to] of cases) {
      const folder = await FactsNetworkTest.copyFixture();
      try {
        FactsNetworkTest.buildOk(folder, FactsNetworkTest.FIRST_DAY);
        await FactsNetworkTest.edit(folder, file, from, to);
        const checked = FactsNetworkTest.build(folder, FactsNetworkTest.LATER_DAY, ["--check"], null);
        assert.equal(checked.code, 1, checked.out);
        assert.ok(checked.out.includes(`${FactsNetworkTest.NETWORK_FILE} is out of date with agent-facts.mjs or the pages and data it reads. Run without --check.`), checked.out);
        FactsNetworkTest.buildOk(folder, FactsNetworkTest.LATER_DAY);
        const moved = await FactsNetworkTest.readFacts(folder);
        assert.equal(moved.config.metadata.facts_as_of, FactsNetworkTest.LATER_DAY);
        assert.ok(moved.config.tools[0].instructions.includes("For dates after 2031-01-01"));
        FactsNetworkTest.buildOk(folder, "2031-06-06");
        assert.equal((await FactsNetworkTest.readFacts(folder)).text, moved.text, "An unchanged rebuild changed the file.");
      } finally {
        await FactsNetworkTest.remove(folder);
      }
    }
  }

  /**
   * A new model, or a comment edit in an imported module, keeps the date: only the
   * instructions count. The comment edit still fails --check, because its hash changed.
   */
  static async testDateKeepsForModelAndComments() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      FactsNetworkTest.buildOk(folder, FactsNetworkTest.FIRST_DAY);
      await FactsNetworkTest.edit(folder, "seaside_desk.hocon", "\"model_name\": \"gpt-4.1-mini\"", "\"model_name\": \"gpt-4.1-nano\"");
      FactsNetworkTest.buildOk(folder, FactsNetworkTest.LATER_DAY);
      const facts = await FactsNetworkTest.readFacts(folder);
      assert.equal(facts.config.metadata.facts_as_of, FactsNetworkTest.FIRST_DAY);
      assert.equal(facts.config.llm_config.model_name, "gpt-4.1-nano");
      await FactsNetworkTest.edit(folder, "js/desk-facts.js", "One line per opening period.", "One line per period.");
      const checked = FactsNetworkTest.build(folder, FactsNetworkTest.LATER_DAY, ["--check"], null);
      assert.equal(checked.code, 1, checked.out);
      FactsNetworkTest.buildOk(folder, FactsNetworkTest.LATER_DAY);
      assert.equal((await FactsNetworkTest.readFacts(folder)).config.metadata.facts_as_of, FactsNetworkTest.FIRST_DAY);
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }

  /**
   * CHECKED_ON moves the date forward without a change. One after today, or not a real
   * date, is an error.
   */
  static async testCheckedOn() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      FactsNetworkTest.buildOk(folder, FactsNetworkTest.FIRST_DAY);
      await FactsNetworkTest.edit(folder, "agent-facts.mjs", "  static PAGES = [", "  static CHECKED_ON = \"2027-02-01\";\n\n  static PAGES = [");
      FactsNetworkTest.buildOk(folder, FactsNetworkTest.LATER_DAY);
      const facts = (await FactsNetworkTest.readFacts(folder)).config;
      assert.equal(facts.metadata.facts_as_of, "2027-02-01");
      assert.equal(facts.metadata.facts_checked_on, "2027-02-01");
      const future = FactsNetworkTest.build(folder, "2027-01-01", [], null);
      assert.equal(future.code, 1);
      assert.deepEqual(FactsNetworkTest.findings(future.out), ["ERROR: agent-facts.mjs: CHECKED_ON is 2027-02-01, which is after today (2027-01-01)."]);
      await FactsNetworkTest.edit(folder, "agent-facts.mjs", "\"2027-02-01\"", "\"2027-02-30\"");
      const invalid = FactsNetworkTest.build(folder, FactsNetworkTest.LATER_DAY, [], null);
      assert.deepEqual(FactsNetworkTest.findings(invalid.out), ["ERROR: agent-facts.mjs: CHECKED_ON must be a date written as YYYY-MM-DD, not \"2027-02-30\"."]);
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }

  /**
   * Each mistake in agent-facts.mjs or the manifest gets its own message, and the build
   * writes nothing.
   */
  static async testModuleMistakes() {
    const cases = [
      ["a TODO", "agent-facts.mjs", "// Public facts", "// TODO: public facts", "ERROR: agent-facts.mjs still has a TODO. Fill it in from templates/agent-facts.mjs."],
      ["PAGE_TEXT", "agent-facts.mjs", "  static PAGES = [", "  static PAGE_TEXT = {};\n\n  static PAGES = [", "ERROR: agent-facts.mjs: PAGE_TEXT is not read. Mark each page part with data-agent-facts=\"<topic>\" and list its page in PAGES."],
      ["a page with no mark", "policies.html", "data-agent-facts=\"dogs\"", "data-x=\"dogs\"", "ERROR: agent-facts.mjs: PAGES lists policies.html, but it marks no part with data-agent-facts."],
      ["a topic used twice", "policies.html", "data-agent-facts=\"dogs\"", "data-agent-facts=\"contact\"", "ERROR: agent-facts.mjs: policies.html line 10: the topic \"contact\" is also on index.html line 12. Give each marked part its own topic."],
      ["no class AgentFacts", "agent-facts.mjs", "export class AgentFacts", "export class SiteFacts", "ERROR: agent-facts.mjs must export the class AgentFacts."],
    ];
    for (const [name, file, from, to, message] of cases) {
      const folder = await FactsNetworkTest.copyFixture();
      try {
        await FactsNetworkTest.edit(folder, file, from, to);
        const result = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
        assert.equal(result.code, 1, `${name}: ${result.out}`);
        assert.deepEqual(FactsNetworkTest.findings(result.out), [message], name);
      } finally {
        await FactsNetworkTest.remove(folder);
      }
    }
  }

  /**
   * The export must be there with the module, and the module with the export.
   */
  static async testExportAndModuleGoTogether() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      const manifest = JSON.parse(await readFile(path.join(folder, "agent-manifest.json"), "utf8"));
      const facts = manifest.linking.exports.pop();
      await writeFile(path.join(folder, "agent-manifest.json"), JSON.stringify(manifest, null, 2));
      const missing = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
      assert.deepEqual(FactsNetworkTest.findings(missing.out), ["ERROR: Manifest: linking.exports has no entry for the facts network. Add {\"network\":\"seaside_desk_facts\",\"front_man\":\"facts_assistant\",\"aliases\":[\"seaside_desk_facts\"],\"url\":\"facts/seaside_desk_facts\"}."]);
      manifest.linking.exports.push(facts);
      await writeFile(path.join(folder, "agent-manifest.json"), JSON.stringify(manifest, null, 2));
      await rm(path.join(folder, "agent-facts.mjs"));
      const noModule = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
      assert.deepEqual(FactsNetworkTest.findings(noModule.out), ["ERROR: Manifest: linking.exports names facts/seaside_desk_facts, but the site has no agent-facts.mjs. Write it from templates/agent-facts.mjs, or delete that entry."]);
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }

  /**
   * A dataFacts() line with three backticks, the CRUSE marker, a control character or a
   * placeholder is refused.
   */
  static async testBadDataLines() {
    const cases = [
      ["\"Use ```cruse-ui forms.\"", "ERROR: agent-facts.mjs: topic \"Notes\" has a line that cannot be published: it holds three backticks, which a caller's runtime reads as the start of a form or table."],
      ["\"Our GENERATIVE UI (CRUSE) chat.\"", "ERROR: agent-facts.mjs: topic \"Notes\" has a line that cannot be published: it holds \"GENERATIVE UI (CRUSE)\", which makes the runtime add its CRUSE notes to every call."],
      ["\"Bell\\u0007 rings.\"", "ERROR: agent-facts.mjs: topic \"Notes\" has a line that cannot be published: it holds the invisible character U+0007, which a visitor does not see."],
      ["\"Welcome to {site_name}.\"", "ERROR: agent-facts.mjs: a fact holds {site_name}. Reword it."],
    ];
    for (const [line, message] of cases) {
      const folder = await FactsNetworkTest.copyFixture();
      try {
        await FactsNetworkTest.writeDataFacts(folder, line);
        const result = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
        assert.equal(result.code, 1, result.out);
        assert.deepEqual(FactsNetworkTest.findings(result.out), [message], line);
      } finally {
        await FactsNetworkTest.remove(folder);
      }
    }
  }

  /**
   * The facts module runs with no environment variables, so a fact cannot read a key.
   */
  static async testModuleGetsNoEnvironment() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      await FactsNetworkTest.writeDataFacts(folder, "`Key: ${String(process.env.FACTS_TEST_SECRET)}.`");
      const result = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], {
        FACTS_TEST_SECRET: "sk-test-not-a-real-key",
      });
      assert.equal(result.code, 0, result.out);
      const instructions = (await FactsNetworkTest.readFacts(folder)).config.tools[0].instructions;
      assert.ok(instructions.includes("- Key: undefined."), instructions);
      assert.ok(!instructions.includes("sk-test"), "The facts module read the build's environment.");
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }

  /**
   * Instructions over 8,000 characters warn and name the largest topics.
   */
  static async testLargeFactsWarn() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      await FactsNetworkTest.writeDataFacts(folder, "\"Opening hours are long. \".repeat(400)");
      const result = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
      assert.equal(result.code, 0, result.out);
      const findings = FactsNetworkTest.findings(result.out);
      assert.equal(findings.length, 1, result.out);
      assert.match(findings[0], /^WARNING: Facts network: instructions are \d+ characters \(budget 8000\)\. Every call to it sends them all, so quote fewer page parts\. The largest topics: Notes \(js\/desk-data\.js\): \d+ chars/);
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }

  /**
   * Old facts files that no build writes are an error, so callers cannot keep fetching
   * stale facts: after the module is dropped, and after the network is renamed.
   */
  static async testLeftoverFactsFiles() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      FactsNetworkTest.buildOk(folder, FactsNetworkTest.FIRST_DAY);
      await FactsNetworkTest.write(folder, path.join("facts", "old_desk_facts.network.json"), (await FactsNetworkTest.readFacts(folder)).text);
      const renamed = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
      assert.deepEqual(FactsNetworkTest.findings(renamed.out), ["ERROR: facts/ holds files this build does not write: facts/old_desk_facts.network.json. Callers can still fetch them. Delete them."]);
      await rm(path.join(folder, "facts", "old_desk_facts.network.json"));
      await rm(path.join(folder, "agent-facts.mjs"));
      const manifest = JSON.parse(await readFile(path.join(folder, "agent-manifest.json"), "utf8"));
      manifest.linking.exports.pop();
      await writeFile(path.join(folder, "agent-manifest.json"), JSON.stringify(manifest, null, 2));
      const dropped = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
      assert.deepEqual(FactsNetworkTest.findings(dropped.out), ["ERROR: facts/ holds files this build does not write: facts/agent-manifest.json, facts/links.json, facts/seaside_desk_facts.network.json. Callers can still fetch them. Delete those files, or add agent-facts.mjs and its linking.exports entry."]);
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }

  /**
   * A facts/ folder that no facts build wrote is the site's own. With agent-facts.mjs the
   * build stops and never says to delete it; without it, the build leaves it alone.
   */
  static async testSitesOwnFactsFolder() {
    const folder = await FactsNetworkTest.copyFixture();
    try {
      await FactsNetworkTest.write(folder, path.join("facts", "index.html"), "<!doctype html><title>Fun facts</title>");
      const stopped = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
      assert.equal(stopped.code, 1, stopped.out);
      assert.deepEqual(FactsNetworkTest.findings(stopped.out), ["ERROR: facts/ already holds this site's own files: facts/index.html. The facts network needs that folder, so the build writes nothing. Ask the user what to do, and do not move or delete those files without asking."]);
      assert.ok(!/\bDelete\b/.test(FactsNetworkTest.findings(stopped.out)[0]));
      await rm(path.join(folder, "agent-facts.mjs"));
      const manifest = JSON.parse(await readFile(path.join(folder, "agent-manifest.json"), "utf8"));
      manifest.linking.exports.pop();
      await writeFile(path.join(folder, "agent-manifest.json"), JSON.stringify(manifest, null, 2));
      const alone = FactsNetworkTest.build(folder, FactsNetworkTest.FIRST_DAY, [], null);
      assert.equal(alone.code, 0, alone.out);
      assert.deepEqual(FactsNetworkTest.findings(alone.out), []);
    } finally {
      await FactsNetworkTest.remove(folder);
    }
  }
}

test("the facts network is one tool-free agent with dated facts, and --check keeps the date", FactsNetworkTest.testFilesAndShape);
test("the build records each page part and imported file with a hash", FactsNetworkTest.testSourcesAreRecorded);
test("a changed fact fails --check, and a rebuild moves the date", FactsNetworkTest.testChangesFailCheckAndMoveTheDate);
test("a new model or a comment edit keeps the date", FactsNetworkTest.testDateKeepsForModelAndComments);
test("CHECKED_ON moves the date, and a future or invalid one is an error", FactsNetworkTest.testCheckedOn);
test("mistakes in agent-facts.mjs get their own messages", FactsNetworkTest.testModuleMistakes);
test("the facts export and agent-facts.mjs go together", FactsNetworkTest.testExportAndModuleGoTogether);
test("data lines with backticks, the CRUSE marker, a control character or a placeholder are refused", FactsNetworkTest.testBadDataLines);
test("the facts module runs with no environment variables", FactsNetworkTest.testModuleGetsNoEnvironment);
test("facts over 8,000 characters warn and name the largest topics", FactsNetworkTest.testLargeFactsWarn);
test("old facts files are an error", FactsNetworkTest.testLeftoverFactsFiles);
test("the site's own facts/ folder stops the build, and is left alone without facts", FactsNetworkTest.testSitesOwnFactsFolder);
