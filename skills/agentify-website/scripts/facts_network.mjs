// Build the facts network that other agent sites call, from the site's agent-facts.mjs.
//
// build_network.mjs uses this class when agent-facts.mjs sits next to the manifest.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { MarkedText } from "./marked_text.mjs";

/**
 * Writes a second, small network for other agent sites: one agent with no tools, whose
 * instructions hold this site's dated public facts.
 *
 * It runs the site's agent-facts.mjs in a separate Node process with an empty
 * environment, quotes the page parts the owner marked, and fills
 * templates/facts-network.hocon. The site's own page never loads this network, so its
 * own model calls do not grow. A caller runs it as one model call.
 *
 * The facts' date is the day the build last found them changed. So --check gives the
 * same answer on any day, and fails only when the site's pages or data changed.
 */
export class FactsNetwork {
  /**
   * The folder, next to the site's manifest, that holds the facts network.
   */
  static FOLDER = "facts";

  /**
   * The site's facts module, next to its manifest.
   */
  static MODULE = "agent-facts.mjs";

  /**
   * The facts network template.
   */
  static TEMPLATE = new URL("../templates/facts-network.hocon", import.meta.url);

  /**
   * A phrase of the template's rules, looked for in the facts network's instructions.
   */
  static RULES = "when another website's assistant asks for its visitor";

  /**
   * The template's placeholders. None may be left after the build fills them.
   */
  static TOKENS = [
    "site_name",
    "as_of",
    "year_after",
    "model_name",
    "public_facts",
  ];

  /**
   * Instructions above this size get a warning. A call to a site's main network sends
   * about 8,200 characters today and answers less.
   */
  static MAX_CHARS = 8000;

  /**
   * The most model calls a facts network may take. Each is paid by a caller's visitor.
   */
  static MAX_STEPS = 2;

  /**
   * How long the facts module may take to load and give its facts.
   */
  static LOAD_TIMEOUT_MS = 30000;

  /**
   * The code the separate Node process runs. It imports agent-facts.mjs from the URL in
   * process.argv[1] and prints what the build needs as JSON. The process gets an empty
   * environment, so a fact cannot read a key or token from it.
   */
  static LOADER = [
    "const loaded = await import(process.argv[1]);",
    "const facts = loaded.AgentFacts;",
    "const out = {found: typeof facts === \"function\"};",
    "if (out.found) {",
    "  out.pages = facts.PAGES === undefined ? null : facts.PAGES;",
    "  out.pageText = facts.PAGE_TEXT !== undefined;",
    "  out.checkedOn = facts.CHECKED_ON === undefined ? null : facts.CHECKED_ON;",
    "  out.hasDataFacts = typeof facts.dataFacts === \"function\";",
    "  if (out.hasDataFacts) {",
    "    try {",
    "      out.topics = facts.dataFacts();",
    "    } catch (error) {",
    "      out.dataError = String(error && error.message ? error.message : error);",
    "    }",
    "  }",
    "}",
    "process.stdout.write(JSON.stringify(out));",
  ].join("\n");

  /**
   * Store what the build knows about the site.
   *
   * :param options: siteDir, networkName, siteName, model, manifest, runtime and today.
   */
  constructor(options) {
    this.options = options;
    this.errors = [];
    this.warnings = [];
    // Output file path -> the text the build writes there.
    this.outputs = new Map();
    this.name = `${options.networkName}_facts`;
    this.asOf = null;
    this.instructionChars = 0;
    this.lineCount = 0;
    // What the facts were read from, recorded in metadata.facts_sources so that
    // check_partner.mjs can compare them with the live site after an upload.
    this.sources = {
      site: "../",
      pages: [],
      data: [],
    };
    // The owner's AgentFacts.CHECKED_ON date, or null when it is not set.
    this.checkedOn = null;
  }

  /**
   * The facts network's URL path, relative to the site's folder.
   *
   * :param networkName: The site's network name.
   * :return: The path, such as "facts/tidewhistle_guesthouse_facts".
   */
  static urlPath(networkName) {
    return `${FactsNetwork.FOLDER}/${networkName}_facts`;
  }

  /**
   * Say whether a site folder has a facts module.
   *
   * :param siteDir: The folder that holds the manifest.
   * :return: The module's path, or null when there is none.
   */
  static async moduleIn(siteDir) {
    const file = path.join(siteDir, FactsNetwork.MODULE);
    try {
      await readFile(file);
    } catch (error) {
      return null;
    }
    return file;
  }

  /**
   * Say whether a facts folder holds a facts network that a build wrote: a network file
   * with metadata.facts_as_of, or a manifest whose network has the public-facts tag.
   *
   * :param folder: The facts folder.
   * :param names: The file names in it.
   * :return: True when a build wrote facts there; false when the folder is the site's own.
   */
  static async holdsFactsNetwork(folder, names) {
    for (const name of names) {
      let data = null;
      try {
        data = JSON.parse(await readFile(path.join(folder, name), "utf8"));
      } catch (error) {
        // Not a JSON file, so not one the facts build writes.
        continue;
      }
      if (name.endsWith("_facts.network.json") && data && data.metadata && data.metadata.facts_as_of) {
        return true;
      }
      if (name === "agent-manifest.json" && data && Array.isArray(data.networks)) {
        for (const entry of data.networks) {
          if (Array.isArray(entry.tags) && entry.tags.includes("public-facts")) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Find the manifest's linking.exports entry for the facts network.
   *
   * :param manifest: The site's manifest.
   * :param networkName: The site's network name.
   * :return: The entry, or null when there is none.
   */
  static exportEntry(manifest, networkName) {
    const linking = manifest.linking || {};
    const entries = Array.isArray(linking.exports) ? linking.exports : [];
    for (const entry of entries) {
      if (entry && entry.url === FactsNetwork.urlPath(networkName)) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Build the facts network and its manifest, and check them.
   *
   * :param file: The path of agent-facts.mjs.
   */
  async build(file) {
    const source = await readFile(file, "utf8");
    if (/\bTODO\b/.test(source)) {
      this.errors.push(`${FactsNetwork.MODULE} still has a TODO. Fill it in from templates/agent-facts.mjs.`);
      return;
    }
    const loaded = await FactsNetwork.load(file);
    if (loaded.error !== undefined) {
      this.errors.push(`${FactsNetwork.MODULE}: ${loaded.error}`);
      return;
    }
    if (!loaded.found) {
      this.errors.push(`${FactsNetwork.MODULE} must export the class AgentFacts.`);
      return;
    }
    this.readCheckedOn(loaded.checkedOn);
    const sections = [];
    await this.addDataFacts(loaded, sections);
    if (loaded.pageText) {
      this.errors.push(`${FactsNetwork.MODULE}: PAGE_TEXT is not read. Mark each page part with ${MarkedText.MARK}="<topic>" and list its page in PAGES.`);
    }
    await this.addMarkedFacts(loaded.pages, sections);
    if (!this.lineCount && !this.errors.length) {
      this.errors.push(`${FactsNetwork.MODULE} gives no facts. List marked pages in PAGES or lines in dataFacts().`);
    }
    const factsText = sections.join("\n");
    this.checkFactsText(factsText);
    this.checkExport();
    await this.addDataSources(file);
    if (this.errors.length) {
      return;
    }
    await this.addNetwork(factsText);
  }

  /**
   * Import agent-facts.mjs in a separate Node process with an empty environment, and
   * read its PAGES, CHECKED_ON and dataFacts().
   *
   * :param file: The path of agent-facts.mjs.
   * :return: What the module gave: found, pages, pageText, checkedOn, hasDataFacts,
   *   topics and dataError; or {error} when it could not be loaded.
   */
  static async load(file) {
    const run = promisify(execFile);
    let result = null;
    try {
      result = await run(process.execPath, [
        "--input-type=module",
        "-e",
        FactsNetwork.LOADER,
        pathToFileURL(path.resolve(file)).href,
      ], {
        env: {},
        timeout: FactsNetwork.LOAD_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (error) {
      return {
        error: FactsNetwork.loadError(error),
      };
    }
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      return {
        error: "it printed something besides its facts. Remove its console output.",
      };
    }
  }

  /**
   * Turn a failed load into a short message: the first error line Node printed.
   *
   * :param error: The error from execFile.
   * :return: The message.
   */
  static loadError(error) {
    if (error && error.killed) {
      return `it did not finish loading within ${FactsNetwork.LOAD_TIMEOUT_MS / 1000} seconds.`;
    }
    const text = error && typeof error.stderr === "string" ? error.stderr : "";
    for (const line of text.split("\n")) {
      if (/^\w*Error\b|^Error:/.test(line.trim())) {
        return line.trim();
      }
    }
    return error && error.message ? error.message.split("\n")[0] : "it could not be loaded.";
  }

  /**
   * Add the facts that come from the site's data modules, one topic at a time.
   *
   * :param loaded: What the facts module gave (from load).
   * :param sections: The facts text, one entry per line, which this adds to.
   */
  async addDataFacts(loaded, sections) {
    if (!loaded.hasDataFacts) {
      return;
    }
    if (loaded.dataError !== undefined) {
      this.errors.push(`${FactsNetwork.MODULE}: dataFacts() failed: ${loaded.dataError}`);
      return;
    }
    const topics = loaded.topics;
    if (!Array.isArray(topics)) {
      this.errors.push(`${FactsNetwork.MODULE}: dataFacts() must return a list of topics.`);
      return;
    }
    for (const topic of topics) {
      const title = topic && typeof topic.title === "string" ? topic.title.trim() : "";
      const source = topic && typeof topic.source === "string" ? topic.source : "";
      const lines = topic && Array.isArray(topic.lines) ? topic.lines : [];
      if (!title || !lines.length) {
        this.errors.push(`${FactsNetwork.MODULE}: each dataFacts() topic needs a title and at least one line.`);
        continue;
      }
      if (!(await this.isSiteFile(source))) {
        this.errors.push(`${FactsNetwork.MODULE}: topic "${title}" names source "${source}", which is not a file in the site.`);
        continue;
      }
      sections.push(`## ${title} (${source})`);
      for (const line of lines) {
        const text = typeof line === "string" ? line.replace(/\s+/g, " ").trim() : "";
        if (!text) {
          this.errors.push(`${FactsNetwork.MODULE}: topic "${title}" has an empty line.`);
          continue;
        }
        const problem = MarkedText.problemInText(text);
        if (problem !== null) {
          this.errors.push(`${FactsNetwork.MODULE}: topic "${title}" has a line that cannot be published: ${problem}.`);
          continue;
        }
        sections.push(`- ${text}`);
        this.lineCount += 1;
      }
    }
  }

  /**
   * Add the parts of each page in AgentFacts.PAGES that the owner marked for callers,
   * quoted word for word, in page order. Each part is recorded with a hash of its lines,
   * so a check after upload can tell when the live page says something else.
   *
   * :param pages: AgentFacts.PAGES: page paths relative to the site folder.
   * :param sections: The facts text, one entry per line, which this adds to.
   */
  async addMarkedFacts(pages, sections) {
    if (pages === undefined || pages === null) {
      return;
    }
    if (!Array.isArray(pages)) {
      this.errors.push(`${FactsNetwork.MODULE}: PAGES must list page paths, such as ["index.html", "policies.html"].`);
      return;
    }
    // A topic names one part, so callers' quotes are never ambiguous.
    const topics = new Map();
    for (const page of pages) {
      const ref = String(page);
      if (!/^[\w./-]+\.html?$/.test(ref) || ref.includes("..") || !(await this.isSiteFile(ref))) {
        this.errors.push(`${FactsNetwork.MODULE}: PAGES lists "${ref}". Name a page in the site folder, such as "policies.html".`);
        continue;
      }
      const html = (await readFile(path.join(this.options.siteDir, ref), "utf8")).replace(/\r\n/g, "\n");
      const result = MarkedText.parts(html);
      for (const message of result.errors) {
        this.errors.push(`${FactsNetwork.MODULE}: ${ref}: ${message}`);
      }
      if (!result.parts.length && !result.errors.length) {
        this.errors.push(`${FactsNetwork.MODULE}: PAGES lists ${ref}, but it marks no part with ${MarkedText.MARK}.`);
      }
      for (const part of result.parts) {
        if (topics.has(part.topic)) {
          this.errors.push(`${FactsNetwork.MODULE}: ${ref} line ${part.line}: the topic "${part.topic}" is also on ${topics.get(part.topic)}. Give each marked part its own topic.`);
          continue;
        }
        topics.set(part.topic, `${ref} line ${part.line}`);
        sections.push(`## ${part.topic} (${ref})`);
        for (const line of part.lines) {
          sections.push(line);
          this.lineCount += 1;
        }
        this.sources.pages.push({
          page: ref,
          topic: part.topic,
          sha256: FactsNetwork.hash(part.lines.join("\n")),
        });
      }
    }
  }

  /**
   * Say whether a relative path names a file inside the site folder.
   *
   * :param relative: The path, such as "js/guesthouse-data.js".
   * :return: True when the file exists inside the site folder.
   */
  async isSiteFile(relative) {
    if (!relative || path.isAbsolute(relative)) {
      return false;
    }
    const root = path.resolve(this.options.siteDir);
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) {
      return false;
    }
    try {
      await readFile(file);
    } catch (error) {
      return false;
    }
    return true;
  }

  /**
   * Refuse facts that hold one of the template's placeholders. The build would leave it
   * unfilled, so the caller would read "{site_name}" as written.
   *
   * :param factsText: The facts, one line per entry, joined by newlines.
   */
  checkFactsText(factsText) {
    for (const name of FactsNetwork.TOKENS) {
      if (factsText.includes(`{${name}}`)) {
        this.errors.push(`${FactsNetwork.MODULE}: a fact holds {${name}}. Reword it.`);
      }
    }
  }

  /**
   * Check that the site's manifest lists the facts network in linking.exports, so callers
   * and nsdeploy's linker can find it.
   */
  checkExport() {
    const entry = FactsNetwork.exportEntry(this.options.manifest, this.options.networkName);
    if (entry !== null && entry.network === this.name) {
      return;
    }
    const wanted = {
      network: this.name,
      front_man: "facts_assistant",
      aliases: [
        this.name,
      ],
      url: FactsNetwork.urlPath(this.options.networkName),
    };
    this.errors.push(`Manifest: linking.exports has no entry for the facts network. Add ${JSON.stringify(wanted)}.`);
  }

  /**
   * Read the owner's optional AgentFacts.CHECKED_ON date: the day they last checked that
   * the facts are still true. It moves "as of" without a clock, so --check stays the same
   * on any later day.
   *
   * :param value: AgentFacts.CHECKED_ON, or null.
   */
  readCheckedOn(value) {
    if (value === undefined || value === null || value === "") {
      return;
    }
    if (!FactsNetwork.isDate(value)) {
      this.errors.push(`${FactsNetwork.MODULE}: CHECKED_ON must be a date written as YYYY-MM-DD, not ${JSON.stringify(value)}.`);
      return;
    }
    if (value > this.options.today) {
      this.errors.push(`${FactsNetwork.MODULE}: CHECKED_ON is ${value}, which is after today (${this.options.today}).`);
      return;
    }
    this.checkedOn = value;
  }

  /**
   * Record each site file the facts module loads, with a hash of its text, so a later
   * check can tell when the live site's data no longer matches the published facts.
   *
   * It follows the module's static relative imports. A site module that loads others
   * at run time is not followed, so keep data imports static.
   *
   * :param file: The path of agent-facts.mjs.
   */
  async addDataSources(file) {
    const root = path.resolve(this.options.siteDir);
    const seen = new Set();
    const queue = [path.resolve(file)];
    while (queue.length) {
      const current = queue.shift();
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      let text = null;
      try {
        text = (await readFile(current, "utf8")).replace(/^﻿/, "");
      } catch (error) {
        continue;
      }
      this.sources.data.push({
        file: path.relative(root, current).split(path.sep).join("/"),
        sha256: FactsNetwork.hash(text),
      });
      for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["'](\.{1,2}\/[^"']+)["']|(?:^|\n)\s*import\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = path.resolve(path.dirname(current), match[1] || match[2]);
        // Only files inside the site are part of what it publishes.
        if (target.startsWith(`${root}${path.sep}`)) {
          queue.push(target);
        }
      }
    }
    this.sources.data.sort(FactsNetwork.byFile);
  }

  /**
   * Order data sources by file name, so the recorded list does not depend on import order.
   *
   * :param a: One source.
   * :param b: Another source.
   * :return: A negative number, zero or a positive number, as for Array.sort.
   */
  static byFile(a, b) {
    if (a.file < b.file) {
      return -1;
    }
    return a.file > b.file ? 1 : 0;
  }

  /**
   * Give the sha256 of a text, in hex.
   *
   * :param text: The text.
   * :return: The hash.
   */
  static hash(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

  /**
   * Fill the template, keep the published date when the facts did not change, check the
   * result, and add the facts files to the outputs.
   *
   * :param factsText: The facts, one line per entry, joined by newlines.
   */
  async addNetwork(factsText) {
    const folder = path.join(this.options.siteDir, FactsNetwork.FOLDER);
    const networkFile = path.join(folder, `${this.name}.network.json`);
    const template = this.options.runtime.parseHocon((await readFile(FactsNetwork.TEMPLATE, "utf8")).replace(/\r\n/g, "\n"));
    const published = await FactsNetwork.readText(networkFile);
    const publishedDate = FactsNetwork.publishedDate(published);
    let asOf = this.options.today;
    // Unchanged instructions keep their date. Only the instructions count, so a new model
    // or a changed source hash does not move "as of".
    if (publishedDate !== null && FactsNetwork.instructionsOf(this.networkText(template, factsText, publishedDate)) === FactsNetwork.instructionsOf(published)) {
      asOf = publishedDate;
    }
    // The owner's check moves the date forward, never back.
    if (this.checkedOn !== null && this.checkedOn > asOf) {
      asOf = this.checkedOn;
    }
    const text = this.networkText(template, factsText, asOf);
    this.asOf = asOf;
    const config = JSON.parse(text);
    this.checkNetwork(config);
    this.checkParse(text, config);
    this.outputs.set(networkFile, text);
    this.outputs.set(path.join(folder, "agent-manifest.json"), `${JSON.stringify(this.manifest(), null, 2)}\n`);
    this.outputs.set(path.join(folder, "links.json"), `${JSON.stringify(this.links(), null, 2)}\n`);
  }

  /**
   * Fill the template and return the network file's text.
   *
   * :param template: The parsed template.
   * :param factsText: The facts text.
   * :param asOf: The date to give the facts.
   * :return: The JSON text, ending with a line break.
   */
  networkText(template, factsText, asOf) {
    const values = {
      site_name: this.options.siteName,
      as_of: asOf,
      year_after: FactsNetwork.yearAfter(asOf),
      model_name: this.options.model,
      public_facts: factsText,
    };
    const config = FactsNetwork.fill(template, values);
    config.metadata = config.metadata || {};
    // Metadata never reaches a model (runtime/runner.js builds the prompt from the
    // instructions only), so the sources cost callers nothing.
    config.metadata.facts_sources = this.sources;
    if (this.checkedOn !== null) {
      config.metadata.facts_checked_on = this.checkedOn;
    }
    return `${JSON.stringify(config, null, 2)}\n`;
  }

  /**
   * Return the joined instructions of a network file's agents.
   *
   * :param text: The network file's text, or null.
   * :return: The instructions, or null when the text is missing or not JSON.
   */
  static instructionsOf(text) {
    if (text === null) {
      return null;
    }
    let config = null;
    try {
      config = JSON.parse(text);
    } catch (error) {
      return null;
    }
    const parts = [];
    for (const agent of Array.isArray(config.tools) ? config.tools : []) {
      parts.push(String((agent || {}).instructions || ""));
    }
    return parts.join("\n");
  }

  /**
   * Replace the {placeholders} in every string of a value. public_facts goes in last, so
   * text from the site is never read as a placeholder.
   *
   * :param value: The template, or a part of it.
   * :param values: The placeholder values.
   * :return: A filled-in copy.
   */
  static fill(value, values) {
    if (typeof value === "string") {
      let text = value;
      for (const name of FactsNetwork.TOKENS) {
        if (name !== "public_facts") {
          text = text.split(`{${name}}`).join(values[name]);
        }
      }
      return text.split("{public_facts}").join(values.public_facts);
    }
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) {
        items.push(FactsNetwork.fill(item, values));
      }
      return items;
    }
    if (value !== null && typeof value === "object") {
      const filled = {};
      for (const key of Object.keys(value)) {
        filled[key] = FactsNetwork.fill(value[key], values);
      }
      return filled;
    }
    return value;
  }

  /**
   * Check the filled facts network the way a caller's runtime will load it.
   *
   * :param config: The filled network.
   */
  checkNetwork(config) {
    const runtime = this.options.runtime;
    const network = new runtime.AgentNetwork(config, this.name);
    for (const message of runtime.validateNetwork(network).errors) {
      this.errors.push(`Facts network: ${message}`);
    }
    if (config.cruse !== undefined) {
      this.errors.push("Facts network: it must have no \"cruse\" block, or callers add about 1,900 characters of notes and a render_cruse tool to every call.");
    }
    const steps = config.max_steps;
    if (!Number.isInteger(steps) || steps < 1 || steps > FactsNetwork.MAX_STEPS) {
      this.errors.push(`Facts network: set "max_steps": ${FactsNetwork.MAX_STEPS} for the network and in no agent. Each step is a model call on a caller's visitor's key.`);
    }
    const agents = Array.isArray(config.tools) ? config.tools : [];
    for (const agent of agents) {
      const instructions = typeof agent.instructions === "string" ? agent.instructions : "";
      if (!Array.isArray(agent.tools) || agent.tools.length) {
        this.errors.push(`Facts network: ${agent.name} must have "tools": []. Callers run it on their visitor's key, and a tool would run there.`);
      }
      if (agent.max_steps !== undefined) {
        this.errors.push(`Facts network: set "max_steps": ${FactsNetwork.MAX_STEPS} for the network and in no agent. Each step is a model call on a caller's visitor's key.`);
      }
      if (!instructions.includes(FactsNetwork.RULES)) {
        this.errors.push(`Facts network: ${agent.name} lacks the template's rules.`);
      }
      const problem = MarkedText.problemInText(instructions);
      if (problem !== null) {
        this.errors.push(`Facts network: ${agent.name}'s instructions cannot be published: ${problem}.`);
      }
      for (const name of FactsNetwork.TOKENS) {
        if (JSON.stringify(agent).includes(`{${name}}`)) {
          this.errors.push(`Facts network: {${name}} is left unfilled in the template.`);
        }
      }
      this.instructionChars = instructions.length;
      if (instructions.length > FactsNetwork.MAX_CHARS) {
        this.warnings.push(`Facts network: instructions are ${instructions.length} characters (budget ${FactsNetwork.MAX_CHARS}). Every call to it sends them all, so quote fewer page parts. The largest topics: ${FactsNetwork.largestTopics(instructions).join(", ")}.`);
      }
    }
  }

  /**
   * Check that a caller's runtime reads the written file as JSON does. Its HOCON parser
   * reads some escapes, such as \b and \f, differently, and would change the facts.
   *
   * :param text: The network file's text.
   * :param config: The same file, parsed as JSON.
   */
  checkParse(text, config) {
    let read = null;
    try {
      read = this.options.runtime.parseHocon(text);
    } catch (error) {
      this.errors.push(`Facts network: the runtime cannot read the written file: ${error.message}`);
      return;
    }
    const agents = Array.isArray(config.tools) ? config.tools : [];
    const readAgents = Array.isArray(read.tools) ? read.tools : [];
    for (let index = 0; index < agents.length; index += 1) {
      const readAgent = readAgents[index] || {};
      if (readAgent.instructions !== agents[index].instructions) {
        this.errors.push(`Facts network: the runtime reads ${agents[index].name}'s instructions differently from the written file. Remove control characters from the facts.`);
      }
    }
  }

  /**
   * Name the three largest topics in the facts, so an author knows what to cut.
   *
   * :param instructions: The facts network's instructions.
   * :return: Up to three "## title (source): N chars" labels, largest first.
   */
  static largestTopics(instructions) {
    const sizes = [];
    let current = null;
    for (const line of instructions.split("\n")) {
      if (line.startsWith("## ")) {
        current = {
          title: line.slice(3),
          size: 0,
        };
        sizes.push(current);
      } else if (current !== null) {
        current.size += line.length + 1;
      }
    }
    sizes.sort(FactsNetwork.bySizeDown);
    const labels = [];
    for (const item of sizes.slice(0, 3)) {
      labels.push(`${item.title}: ${item.size} chars`);
    }
    return labels;
  }

  /**
   * Order topics from largest to smallest.
   *
   * :param a: One topic.
   * :param b: Another topic.
   * :return: A negative number, zero or a positive number, as for Array.sort.
   */
  static bySizeDown(a, b) {
    return b.size - a.size;
  }

  /**
   * The manifest next to the facts network. It names only that network and has no
   * actions and no peers, so callers load no bridge and the network can call no one.
   *
   * :return: The manifest.
   */
  manifest() {
    return {
      // check_partner.mjs suggests the brand as the caller's consent-card label.
      brand: this.options.siteName,
      networks: [
        {
          name: this.name,
          front_man: "facts_assistant",
          hocon: `./${this.name}.network.json`,
          description: `Dated public facts about ${this.options.siteName} for other agent sites.`,
          tags: [
            "agentified-website",
            "public-facts",
          ],
        },
      ],
      // The spec asks every manifest for router metadata. Callers never use a partner's router.
      llm_router: this.options.manifest.llm_router || {},
      allowed_peers: [],
      peer_policy: {
        mode: "closed",
        deny_origins: [],
        note: "Calls no other site.",
      },
      deployment: {
        mode: "static",
      },
    };
  }

  /**
   * The links file next to the facts network, so a caller's links.json fetch finds a file.
   *
   * :return: The links file.
   */
  links() {
    const networks = {};
    networks[this.name] = {};
    return {
      version: 1,
      networks: networks,
    };
  }

  /**
   * Read a text file.
   *
   * :param file: The path.
   * :return: Its text with LF line endings, or null when it is missing.
   */
  static async readText(file) {
    try {
      return (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    } catch (error) {
      return null;
    }
  }

  /**
   * Read the date a published facts network gives its facts.
   *
   * :param text: The published file's text, or null.
   * :return: metadata.facts_as_of, or null when there is no usable date.
   */
  static publishedDate(text) {
    if (text === null) {
      return null;
    }
    let value = null;
    try {
      value = (JSON.parse(text).metadata || {}).facts_as_of;
    } catch (error) {
      return null;
    }
    return FactsNetwork.isDate(value) ? value : null;
  }

  /**
   * Say whether a value is a real calendar date written as YYYY-MM-DD.
   *
   * :param value: The value.
   * :return: True for a valid date.
   */
  static isDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  /**
   * The same day one year later. A 29 February becomes 1 March.
   *
   * :param date: A date, YYYY-MM-DD.
   * :return: The date a year later, YYYY-MM-DD.
   */
  static yearAfter(date) {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCFullYear(day.getUTCFullYear() + 1);
    return day.toISOString().slice(0, 10);
  }

  /**
   * Give today's local date as YYYY-MM-DD.
   *
   * :return: The date.
   */
  static today() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }
}
