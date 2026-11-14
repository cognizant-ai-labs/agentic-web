// The facts-network checks of check_partner.mjs: find a partner's facts network, check its
// shape and date, and compare it with the live site it was built from.

import { createHash } from "node:crypto";
import { resolveUrl } from "../runtime/remote.js";
import { MarkedText } from "./marked_text.mjs";

/**
 * Checks a facts network the skill's build wrote (scripts/facts_network.mjs) for
 * check_partner.mjs.
 *
 * Every method takes the running PartnerCheck, for its options, its fetch and its lists
 * of warnings and errors. A facts network is one agent with no tools, so a caller runs it
 * as one model call on its visitor's key and it can never call back.
 */
export class FactsCheck {
  /**
   * The manifest tag the skill's build gives a facts network.
   */
  static TAG = "public-facts";

  /**
   * The size at which the skill's build warns about a facts network's instructions.
   */
  static MAX_CHARS = 8000;

  /**
   * The most model calls a facts network may take, as the skill's build sets it.
   */
  static MAX_STEPS = 2;

  /**
   * Say whether a network is a facts network: its manifest entry has the public-facts tag,
   * or its file has metadata.facts_as_of.
   *
   * :param entry: The manifest's entry for the network.
   * :param network: The runtime AgentNetwork, or null when the file could not be read.
   * :return: True for a facts network.
   */
  static isFactsNetwork(entry, network) {
    if (Array.isArray(entry.tags) && entry.tags.includes(FactsCheck.TAG)) {
      return true;
    }
    const metadata = network !== null ? network.config.metadata || {} : {};
    return metadata.facts_as_of !== undefined;
  }

  /**
   * Find the export entry of the facts network that goes with a main network.
   *
   * :param manifest: The partner's manifest.
   * :param name: The main network's name.
   * :return: The entry, or null when the manifest exports no facts network for it.
   */
  static factsExport(manifest, name) {
    const linking = manifest.linking !== null && typeof manifest.linking === "object" ? manifest.linking : {};
    const entries = Array.isArray(linking.exports) ? linking.exports : [];
    for (const entry of entries) {
      if (entry !== null && typeof entry === "object" && entry.url === `facts/${name}_facts`) {
        return entry;
      }
    }
    return null;
  }

  /**
   * On a main network URL, point to the partner's facts network when it has one. A
   * caller should name only that URL.
   *
   * :param check: The running PartnerCheck.
   * :param manifest: The partner's manifest.
   * :param target: The URL's parts from checkUrl.
   */
  static pointToFacts(check, manifest, target) {
    const entry = FactsCheck.factsExport(manifest, target.name);
    if (entry === null) {
      return;
    }
    const url = `${target.folder}/${entry.url}`;
    if (check.options.origin) {
      check.warnings.push(`This partner publishes a facts network at ${url}. Call that URL: it answers from the partner's dated public facts, in one model call with no bridge, and it cannot call back into this site.`);
      return;
    }
    check.print(`This site also publishes a facts network at ${url}. Check it too: node check_partner.mjs ${url}`);
  }

  /**
   * Fail a facts network whose network file is on another origin. A caller fetches that
   * file with no card for its origin, and that origin would write what callers read.
   *
   * :param check: The running PartnerCheck.
   * :param entry: The manifest's entry for the network.
   * :param target: The URL's parts from checkUrl.
   */
  static checkOrigin(check, entry, target) {
    if (typeof entry.hocon !== "string" || !entry.hocon) {
      return;
    }
    const url = new URL(resolveUrl(target.folder, entry.hocon));
    if (url.origin !== target.origin) {
      check.errors.push(`The facts network's file comes from another origin: ${url.href}. Callers fetch it with no card for that origin, so keep the file in facts/ next to its manifest.`);
    }
  }

  /**
   * Fail a facts network that could run anything but one tool-free agent on a caller's
   * visitor's key: actions, coded tools, agent tools, MCP servers, a cruse block, or more
   * model calls than MAX_STEPS.
   *
   * :param check: The running PartnerCheck.
   * :param manifest: The facts network's manifest.
   * :param network: The runtime AgentNetwork, or null when the file could not be read.
   */
  static checkShape(check, manifest, network) {
    const found = [];
    if (manifest.actions !== undefined && manifest.actions !== null) {
      found.push("actions in the manifest");
    }
    if (manifest.coded_tools !== undefined && manifest.coded_tools !== null) {
      found.push("coded_tools in the manifest");
    }
    if (network !== null) {
      const config = network.config;
      if (config.cruse !== undefined) {
        found.push("a cruse block");
      }
      const steps = config.max_steps;
      if (!Number.isInteger(steps) || steps > FactsCheck.MAX_STEPS) {
        found.push(steps === undefined ? "no max_steps" : `max_steps ${JSON.stringify(steps)}`);
      }
      const agents = Array.isArray(config.tools) ? config.tools : [];
      for (const agent of agents) {
        if (typeof agent.instructions !== "string") {
          found.push(`the tool ${agent.name}`);
          continue;
        }
        if (Array.isArray(agent.tools) && agent.tools.length) {
          const names = [];
          for (const ref of agent.tools) {
            names.push(typeof ref === "string" ? ref : String((ref || {}).url || JSON.stringify(ref)));
          }
          found.push(`tools on ${agent.name}: ${names.join(", ")}`);
        }
        // The runtime copies the network's max_steps into each agent, so only an agent's
        // own, different value counts.
        if (agent.max_steps !== undefined && agent.max_steps !== steps && agent.max_steps > FactsCheck.MAX_STEPS) {
          found.push(`max_steps ${agent.max_steps} on ${agent.name}`);
        }
      }
    }
    if (found.length) {
      check.errors.push(`A facts network must have no actions, coded tools, agent tools or cruse block, and max_steps ${FactsCheck.MAX_STEPS} at most: a caller would run them on its visitor's key. Found: ${found.join("; ")}.`);
    }
  }

  /**
   * Print the facts network's date, age and size, and warn when its size is over the
   * build's warning level or it has no date.
   *
   * :param check: The running PartnerCheck.
   * :param network: The partner's runtime AgentNetwork.
   * :param instructions: Its front agent's instructions.
   */
  static printFacts(check, network, instructions) {
    const metadata = network.config.metadata || {};
    const asOf = String(metadata.facts_as_of || "");
    let when = "with no date";
    if (FactsCheck.isDate(asOf)) {
      when = `as of ${asOf} (${FactsCheck.ageText(FactsCheck.daysBetween(asOf, check.today))})`;
    } else {
      check.warnings.push("The facts network has no metadata.facts_as_of date, so its answers cannot say how old its facts are.");
    }
    const tokens = Math.round(instructions.length / 4);
    check.print(`It is the partner's facts network: it answers only from the facts its site published, ${when}, in one model call of about ${tokens} tokens.`);
    if (FactsCheck.isDate(String(metadata.facts_checked_on || ""))) {
      check.print(`  Its owner last checked the facts on ${metadata.facts_checked_on}.`);
    }
    if (instructions.length > FactsCheck.MAX_CHARS) {
      check.warnings.push(`The facts are ${instructions.length} characters, over the ${FactsCheck.MAX_CHARS} at which the skill's build warns. Every call sends them all, on the calling visitor's key.`);
    }
  }

  /**
   * Compare a facts network with the live site it came from: quote each recorded page part
   * again and hash each recorded data file. It runs only on this site's own facts URL (no
   * --origin), after an upload: a caller cannot fix a partner's files, so it sees the date.
   *
   * :param check: The running PartnerCheck.
   * :param network: The runtime AgentNetwork, or null when the file could not be read.
   * :param target: The URL's parts from checkUrl.
   */
  static async checkSources(check, network, target) {
    if (check.options.origin || network === null) {
      return;
    }
    const sources = (network.config.metadata || {}).facts_sources;
    if (sources === null || typeof sources !== "object") {
      check.print("The facts network lists no sources, so this check cannot compare its facts with the live site.");
      return;
    }
    let site = null;
    try {
      site = new URL(String(sources.site || "../"), `${target.folder}/`).href;
    } catch (error) {
      site = null;
    }
    if (site === null || new URL(site).origin !== target.origin) {
      check.warnings.push("The facts network names its sources on another origin, so this check does not compare them.");
      return;
    }
    const changes = [];
    const parts = await FactsCheck.comparePages(check, sources.pages, site, changes);
    const files = await FactsCheck.compareDataFiles(check, sources.data, site, changes);
    if (!changes.length) {
      check.print(`Compared with the live site: ${parts} quoted page parts and ${files} data files match the facts.`);
      return;
    }
    check.errors.push(`The facts are out of date with the live site: ${changes.join("; ")}. Rebuild with build_network.mjs and upload facts/ again. A host that rewrites pages or scripts, such as one that minifies them or hides email addresses, also shows as a change here.`);
  }

  /**
   * Quote each recorded page's marked parts from the live page, and compare each part's
   * lines with the hash the build recorded.
   *
   * :param check: The running PartnerCheck.
   * :param recorded: metadata.facts_sources.pages: {page, topic, sha256} items.
   * :param site: The site's folder URL, ending in "/".
   * :param changes: The list of changes, which this adds to.
   * :return: The number of parts that match.
   */
  static async comparePages(check, recorded, site, changes) {
    const items = Array.isArray(recorded) ? recorded : [];
    // Each page is read once: page -> Map of topic -> sha256, or null when unreadable.
    const live = new Map();
    let matched = 0;
    for (const item of items) {
      const page = String((item || {}).page || "");
      if (!/^[\w./-]+\.html?$/.test(page) || page.split("/").includes("..")) {
        changes.push(`"${page}" does not name a page in the site`);
        continue;
      }
      if (!live.has(page)) {
        live.set(page, await FactsCheck.livePage(check, page, site, changes));
      }
      const parts = live.get(page);
      if (parts === null) {
        continue;
      }
      const topic = String(item.topic || "");
      if (!parts.has(topic)) {
        changes.push(`${page} no longer marks the part "${topic}"`);
        continue;
      }
      if (parts.get(topic) !== item.sha256) {
        changes.push(`${page}: the part "${topic}" reads differently now`);
        continue;
      }
      matched += 1;
    }
    // A part marked since the build would be missing from the facts.
    for (const [page, parts] of live) {
      if (parts === null) {
        continue;
      }
      for (const topic of parts.keys()) {
        let known = false;
        for (const item of items) {
          if (item && item.page === page && item.topic === topic) {
            known = true;
          }
        }
        if (!known) {
          changes.push(`${page} marks a new part "${topic}"`);
        }
      }
    }
    return matched;
  }

  /**
   * Fetch one live page and hash each of its marked parts, as the build does.
   *
   * :param check: The running PartnerCheck.
   * :param page: The page's path in the site.
   * :param site: The site's folder URL, ending in "/".
   * :param changes: The list of changes, which this adds to.
   * :return: A Map of topic -> sha256 of its lines, or null when the page cannot be read.
   */
  static async livePage(check, page, site, changes) {
    const got = await check.get(new URL(page, site).href, "A quoted page");
    if (got === null || got.response.status !== 200) {
      changes.push(`${page} cannot be read`);
      return null;
    }
    const result = MarkedText.parts(got.text.replace(/\r\n/g, "\n"));
    if (result.errors.length) {
      changes.push(`${page}: ${result.errors[0]}`);
      return null;
    }
    const parts = new Map();
    for (const part of result.parts) {
      parts.set(part.topic, FactsCheck.hash(part.lines.join("\n")));
    }
    return parts;
  }

  /**
   * Hash each recorded data file from the live site and compare it with the facts' record.
   *
   * :param check: The running PartnerCheck.
   * :param files: metadata.facts_sources.data: {file, sha256} items.
   * :param site: The site's folder URL, ending in "/".
   * :param changes: The list of changes, which this adds to.
   * :return: The number of files that match.
   */
  static async compareDataFiles(check, files, site, changes) {
    let matched = 0;
    for (const source of Array.isArray(files) ? files : []) {
      const file = String((source || {}).file || "");
      if (!file || file.startsWith("/") || file.split("/").includes("..")) {
        changes.push(`"${file}" does not name a site file`);
        continue;
      }
      const got = await check.get(new URL(file, site).href, "A data file");
      if (got === null || got.response.status !== 200) {
        changes.push(`${file} cannot be read`);
        continue;
      }
      // The build hashes the file's text the same way: UTF-8, without a leading BOM.
      if (FactsCheck.hash(got.text.replace(/^﻿/, "")) !== source.sha256) {
        changes.push(`${file} has changed`);
        continue;
      }
      matched += 1;
    }
    return matched;
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
   * Say how old something is, from a number of days.
   *
   * :param days: The days since the date; negative for a date after today.
   * :return: Words such as "today", "1 day ago" or "40 days ago".
   */
  static ageText(days) {
    if (days < 0) {
      return "a date after today";
    }
    if (days === 0) {
      return "today";
    }
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }

  /**
   * Count the days from one date to another.
   *
   * :param from: The earlier date, YYYY-MM-DD.
   * :param to: The later date, YYYY-MM-DD.
   * :return: The number of days, negative when from is after to.
   */
  static daysBetween(from, to) {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    return Math.round((end - start) / 86400000);
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
   * Give today's local date as YYYY-MM-DD.
   *
   * :return: The date.
   */
  static localToday() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }
}
