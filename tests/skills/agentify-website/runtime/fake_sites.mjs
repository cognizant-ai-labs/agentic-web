/**
 * Two fake agent websites and a scripted model router, served by a stub fetch.
 *
 * The caller is the site the visitor has open, and its front agent can call the
 * partner's network. The router answers each chat request for the agent named at the
 * start of the system prompt, and records the model that agent asked for. Every URL is
 * answered here, so nothing leaves the process.
 */
export class FakeSites {
  /**
   * The calling site's origin.
   */
  static CALLER = "https://caller.test";

  /**
   * The partner site's origin.
   */
  static PARTNER = "https://partner.test";

  /**
   * The partner's network URL, as the caller's agents list it in tools.
   */
  static PARTNER_URL = "https://partner.test/partner_net";

  /**
   * The tool name the runtime gives that network (runner.js, safeName).
   */
  static PARTNER_TOOL = "partner_net";

  /**
   * The router the caller's manifest names. Every model call must go here.
   */
  static ROUTER = "https://router.test/v1";

  /**
   * The router the partner's manifest names. The runtime must never use it.
   */
  static PARTNER_ROUTER = "https://router.partner.test/v1";

  /**
   * A fake key. Only this stub ever sees it.
   */
  static KEY = "sk-test-not-a-real-key";

  /**
   * The visitor's message, and the request each scripted tool call sends.
   */
  static REQUEST = "Is there a boat trip on Saturday for two?";

  /**
   * A script entry that repeats: from then on, the model calls this tool on every step.
   * No agent has it, so the runtime returns an error and the agent goes on.
   */
  static FOREVER = "keep_going";

  /**
   * Set up the two sites and the router's script.
   *
   * :param callerNetwork: The caller's network config, as its network file holds it.
   * :param partnerNetwork: The partner's network config.
   * :param script: For each agent name, the tools its model calls, one per model call,
   *   before it answers. An agent that is not in the script answers at once.
   */
  constructor(callerNetwork, partnerNetwork, script) {
    this.script = script;
    // URL -> the JSON the site serves there.
    this.files = new Map();
    this.files.set(`${FakeSites.CALLER}/agent-manifest.json`, FakeSites.manifest("caller_net", [FakeSites.PARTNER], FakeSites.ROUTER));
    this.files.set(`${FakeSites.CALLER}/caller_net.network.json`, callerNetwork);
    this.files.set(`${FakeSites.PARTNER}/agent-manifest.json`, FakeSites.manifest("partner_net", [], FakeSites.PARTNER_ROUTER));
    this.files.set(`${FakeSites.PARTNER}/partner_net.network.json`, partnerNetwork);
    // One entry per chat request, with the agent and the model it asked for.
    this.requests = [];
    // URLs that neither site serves. A test expects none.
    this.unexpected = [];
    this.savedFetch = null;
  }

  /**
   * Build an agent whose instructions start with its name, so the router knows it.
   *
   * :param name: The agent name.
   * :param tools: The agent's tools.
   * :param settings: More fields for the agent, such as llm_config or max_steps.
   * :return: The agent spec.
   */
  static agent(name, tools, settings) {
    const agent = {
      name: name,
      function: {
        description: `The ${name} agent.`,
      },
      instructions: `Agent ${name}. Answer the request.`,
      tools: tools,
    };
    return Object.assign(agent, settings);
  }

  /**
   * Build a network config from its settings and agents. The first agent is the front.
   *
   * :param settings: The network's own fields, such as llm_config or max_steps.
   * :param agents: The agents, from agent().
   * :return: The network config.
   */
  static network(settings, agents) {
    const network = Object.assign({}, settings);
    network.tools = agents;
    return network;
  }

  /**
   * Build a static site's manifest with one network.
   *
   * :param name: The network name. Its file is <name>.network.json.
   * :param allowedPeers: The origins the network may call.
   * :param router: The site's router.
   * :return: The manifest.
   */
  static manifest(name, allowedPeers, router) {
    return {
      brand: name,
      networks: [
        {
          name: name,
          hocon: `./${name}.network.json`,
        },
      ],
      llm_router: {
        base_url: router,
        mock: false,
        byok_router: router,
      },
      allowed_peers: allowedPeers,
      peer_policy: {
        mode: "closed",
      },
      deployment: {
        mode: "static",
      },
    };
  }

  /**
   * Answer every fetch with these sites and the router, from now on.
   */
  install() {
    this.savedFetch = globalThis.fetch;
    globalThis.fetch = this.fetch.bind(this);
  }

  /**
   * Put back the fetch that install() replaced.
   */
  restore() {
    globalThis.fetch = this.savedFetch;
  }

  /**
   * The stub fetch. It serves the sites' files and the router.
   *
   * :param input: The URL.
   * :param init: The fetch options.
   * :return: The response.
   */
  async fetch(input, init = {}) {
    // A browser's fetch drops "/./" from a path, and the runtime builds such URLs
    // from "./" paths in a manifest.
    const url = new URL(String(input)).href;
    if (url === `${FakeSites.ROUTER}/chat/completions`) {
      return this.chat(init);
    }
    if (this.files.has(url)) {
      return new Response(JSON.stringify(this.files.get(url)), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
    // Neither site publishes links.json. The runtime reads that as no links.
    if (!url.endsWith("/links.json")) {
      this.unexpected.push(url);
    }
    return new Response("Not found", {status: 404});
  }

  /**
   * Answer one chat request from the script, and record the agent and model.
   *
   * :param init: The fetch options of the request.
   * :return: A streamed reply: the next scripted tool call, or an answer.
   */
  chat(init) {
    const body = JSON.parse(init.body);
    const match = /^Agent (\w+)\./.exec(String(body.messages[0].content));
    const agent = match ? match[1] : "unknown";
    this.requests.push({
      agent: agent,
      model: body.model,
    });
    // Each earlier step of this agent left one tool result.
    let done = 0;
    for (const message of body.messages) {
      if (message.role === "tool") {
        done += 1;
      }
    }
    const steps = this.script[agent] || [];
    let next = steps[done];
    if (next === undefined && steps[steps.length - 1] === FakeSites.FOREVER) {
      next = FakeSites.FOREVER;
    }
    if (next === undefined) {
      return FakeSites.reply({content: `${agent} answer`}, "stop");
    }
    // A misspelled script must fail the test, not quietly call no tool.
    if (next !== FakeSites.FOREVER && !FakeSites.offers(body, next)) {
      return new Response(`The script calls ${next}, but ${agent} does not have it.`, {status: 500});
    }
    return FakeSites.reply({
      tool_calls: [
        {
          index: 0,
          id: `call_${agent}_${done}`,
          function: {
            name: next,
            arguments: JSON.stringify({request: FakeSites.REQUEST}),
          },
        },
      ],
    }, "tool_calls");
  }

  /**
   * Say whether a chat request offers a tool.
   *
   * :param body: The chat request body.
   * :param name: The tool name.
   * :return: True when the request lists the tool.
   */
  static offers(body, name) {
    for (const tool of body.tools || []) {
      if (tool.function.name === name) {
        return true;
      }
    }
    return false;
  }

  /**
   * Wrap one reply as a streamed chat-completions response.
   *
   * :param delta: The reply's content or tool calls.
   * :param finishReason: Why the reply ends.
   * :return: The response.
   */
  static reply(delta, finishReason) {
    const chunk = {
      model: "scripted",
      choices: [
        {
          index: 0,
          delta: delta,
          finish_reason: finishReason,
        },
      ],
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    });
  }

  /**
   * List the models an agent asked for, in the order it first asked.
   *
   * :param agent: The agent name.
   * :return: The model names.
   */
  models(agent) {
    const models = [];
    for (const request of this.requests) {
      if (request.agent === agent && !models.includes(request.model)) {
        models.push(request.model);
      }
    }
    return models;
  }

  /**
   * Count an agent's model calls.
   *
   * :param agent: The agent name.
   * :return: The number of chat requests the agent made.
   */
  calls(agent) {
    let count = 0;
    for (const request of this.requests) {
      if (request.agent === agent) {
        count += 1;
      }
    }
    return count;
  }
}
