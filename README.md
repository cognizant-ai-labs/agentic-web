# The Open Agentic Web Challenge


Create, own and connect agents on today's web. [The Open Agentic Web](https://worldwideagenticweb.org).

> [!IMPORTANT]
> This repository is actively evolving and its content changes frequently.
> Please check back often, and pull the latest version before you use anything here.

## Hackathon

Register for the [DevPost hackathon](https://cognizant-agenticweb.devpost.com/) to build the first publicly accessible
interconnected agentic websites, the foundations of the world wide agentic web.

The [starter tools](#starter-tools) below are optional resources for participants. Registrants can
also claim free credits for [Mozilla's Otari](#mozillas-otari).


## Why

Today, personal AI agents are largely confined to the platforms that build and operate them.
Without open standards, the emerging agent economy risks reproducing the closed ecosystems of
today's internet, where access, visibility and interoperability are controlled by a handful of
companies.

The Open Agentic Web aims to change that. Its vision is a web where people and organizations
can choose their agents, businesses can make their services discoverable to any agent,
and agents can work across platforms regardless of who built them.


## What

An open agentic website is a public website that contains:
- a publicly accessible `.json` file that describes an agent network and its capabilities
- a `runtime` that can run the agent network in the browser
- an interface that allows users to interact with the agent network
- an interface that allows users to configure the LLM and keys to use
  
It must follow the [minimum viable specification](docs/worldwide_agentic_web_mvp_spec.md) for a worldwide agentic web.

### Key principles

- Agent networks are described in **JSON**, a human-readable **configuration** format. Not code.
- Agent networks are **executed in the browser**, without any specific server-side code.
- Users have control over which LLM providers and keys to use, so that the site host **does not pay for LLM calls**.
- Users have control over which sites they visit and which agents they interact with.
- Agent networks can reference other agent networks by URL, allowing them to call and interact with each other.
- Agent networks can call MCP and WebMCP tools

### Existing web infrastructure

Open agentic websites use ordinary web technologies (HTML, CSS, JavaScript, JSON), HTTPS hosting, CORS, WebMCP, MCP and standard web browsers. They are compatible with existing web infrastructure and can be deployed on any public hosting service.

## Spec

The minimum viable specification for a worldwide agentic web is described in [docs/worldwide_agentic_web_mvp_spec.md](docs/worldwide_agentic_web_mvp_spec.md).

## Agentic Websites

See the list of contributed [Agentic Websites](docs/agentic_websites.md):
- for examples and starting points that follow the Open Agentic Web principles
- to find other agents to connect to and grow the capabilities of your agent networks
- to contribute your own agentic websites and let people discover them. Pull requests welcome!

## Examples

The operator of a pizza restaurant wants to agentify their website so that:
- customers can interactively ask questions about the menu. For instance:
  - "What are the vegetarian options?"
  - "I'm lactose intolerant, what can I eat?"
- customers can interactively place orders and choose delivery options. The website can
 delegate the delivery task to other delivery agentic websites.
- other agentic websites can send requests like:
  - "I'm organizing a hackathon and want to order 10 pizzas for delivery at 6pm. Can you help me?"
  - "What's the status for order #12345?"

The LLM provider, model and key used to answer these questions are chosen by the user, not the pizza restaurant. The pizza restaurant does not pay for LLM calls.

## Quickstart

See the [Quickstart guide](docs/quickstart.md) to design an agent network in Neuro SAN Studio, build it into your website with the agentify-website skill, and test it with your own LLM provider API key.

## Agentifying an existing website

### Existing website

Start with the [Little Oven Pizza website](examples/marrow_point_pizza/), a small
restaurant in Marrow Point, the made-up town of the other examples. It is a standalone
HTML, CSS and JavaScript site with a menu (including ingredients, dietary labels and
allergens), a cart, a demo pickup or delivery checkout, and its address and opening
hours. It has no dependencies, backend or agent integration yet.

Run it from the repository root:

```shell
python -m http.server 8080 --directory ./examples/marrow_point_pizza
```

Then open http://127.0.0.1:8080/. Add pizzas to the cart, adjust quantities,
choose pickup or delivery, and place a demo order to see its confirmation.
Orders stay in memory and no payment is collected or food ordered.
See the [example's README](examples/marrow_point_pizza/README.md) for the file layout.

### Agentified version

The [agentified pizza restaurant](examples/marrow_point_pizza_agentified/) is a copy
of the existing website with an assistant section at the end of the page. A coding
agent made it by following the [agentify-website skill](skills/agentify-website/SKILL.md).
The original website remains available on its own. These were the steps:

1. Copy the site, and copy the browser runtime from
   [skills/agentify-website/runtime/](skills/agentify-website/runtime/) into its
   `runtime/` folder unchanged.
2. Expose the site's operations. The page's buttons, its checkout form and the
   assistant all call the same methods on `App.page` in
   [script.js](examples/marrow_point_pizza_agentified/script.js).
   [site-actions.js](examples/marrow_point_pizza_agentified/site-actions.js) registers
   four of them as actions: `get_restaurant_state` reads the menu, cart and page facts,
   `add_to_cart` and `set_cart_quantities` change the cart, and `place_demo_order`
   places an order. Each action says whether it reads, writes, or can't be undone. The
   manifest lists them in `actions.agentTools`, and the runtime offers them to the model
   as `website_*` tools.
3. Write the network in
   [little_oven_pizza.hocon](examples/marrow_point_pizza_agentified/little_oven_pizza.hocon),
   starting from the skill's template. It is one agent, `little_oven_assistant`, that
   takes facts only from tool results and says plainly what the site can't do, such as
   discount codes or table bookings. The site's settings, such as its default model and
   the partner sites it may call, are in
   [agent-manifest.json](examples/marrow_point_pizza_agentified/agent-manifest.json).
4. Build and check the published files:
   ```shell
   node skills/agentify-website/scripts/build_network.mjs \
     examples/marrow_point_pizza_agentified/little_oven_pizza.hocon \
     --manifest examples/marrow_point_pizza_agentified/agent-manifest.json
   ```
   This writes `little_oven_pizza.network.json`, `agent-mcp.json`, the `.well-known/`
   files and the `bridge/` page that other agent sites load. With `--check`, it reports
   problems and stale files without writing anything.
5. Mount the assistant: add its section to `index.html` and boot the runtime from
   [site.js](examples/marrow_point_pizza_agentified/site.js), which also shows the
   dialog that confirms an order.
6. Serve the copy with the skill's server:
   ```shell
   node skills/agentify-website/scripts/serve_site.mjs examples/marrow_point_pizza_agentified --host ::1 --port 8083
   ```
   Unlike `python -m http.server`, it sends the CORS header on the public files, so
   other agent sites can call this one. Open http://[::1]:8083/, scroll to
   **Ask Little Oven Pizza**, and expand **⚙ AI model settings**. Paste your
   [Otari](#mozillas-otari) API key, then select **Save and start**. The example uses
   hosted Otari and `alibaba/qwen3.8-flash` by default. To skip the key, select
   **Connect with OpenRouter** and approve a key on OpenRouter instead
   ([what to know](docs/providers/providers.md#openrouter)), or **Connect with Otari** for
   an otari.ai key ([what to know](docs/providers/otari.md#hosted-otari-otariai)). For another provider, select it in the panel,
   which fills in its provider URL and model, or enter both under
   **Advanced settings (optional)**. The provider must allow requests from the browser.
   The selected provider receives the chat and the page data the assistant reads; LLM
   calls use the visitor's credentials. On `[::1]` the runtime also keeps the key in a
   cookie that other local pages can read, so use a key with a low spending limit.

Try asking "Which pizzas are vegan or gluten-free, and what allergens do they have?" or
"Add two Margherita pizzas and one Roasted Veg to my cart." The assistant calls the cart
tool and the visible cart updates at once. Then ask it to order for pickup or delivery,
with your name and, for delivery, an address. Before the order is placed, a dialog shows
the pizzas, total, name and fulfillment details and asks you to confirm.

Orders still live only in page memory; no food is ordered or payment collected. The
assistant can also ask the guesthouse and harbor tours sites' assistants what they
offer, and other agent sites can call its network (see
[Connect to other agent networks](#connect-to-other-agent-networks)). See the
[agentified example's README](examples/marrow_point_pizza_agentified/README.md)
for linked sites, component details and tests.

### Agentify your own website

The [agentify-website skill](skills/agentify-website/SKILL.md) walks a coding agent
through the same steps for any website, given its source folder or a public URL. Ask
your agent to read and follow `skills/agentify-website/SKILL.md`. It needs Node.js 22
or newer.

[`examples/guesthouse/`](examples/guesthouse/) is a plain guesthouse booking site, and
[`examples/guesthouse_agentified/`](examples/guesthouse_agentified/) is the version an
agent made by following the skill.

## Connect to other agent networks

To expand the capabilities of your agent networks, connect them to other [Agentic Websites](docs/agentic_websites.md).

An agent calls another site's network by its URL: the folder that holds that site's
`agent-manifest.json`, then the network name, such as
`https://partner.example/partner_network`. List that URL in the agent's `tools`, and the
partner's origin in `allowed_peers` in your `agent-manifest.json`: unless `peer_policy`
is `"open"`, the runtime refuses every other origin. Before anything is sent, the
visitor agrees on a card. The partner's network then runs in the visitor's browser, on
the visitor's own key. It gets only the functions the partner site shares with your site.
A shared read, such as live availability, runs in a hidden frame on the partner's site.
A shared write, such as a booking, opens the partner's own window, where the visitor
confirms it. A partner that shares nothing can still say what it offers and point to its
page.

For a site agentified with the skill, follow
[`references/linking.md`](skills/agentify-website/references/linking.md). The build
writes the `bridge/` page that other agent sites load before they run your network, and
`scripts/check_partner.mjs` checks a partner before you add it.
Three sites in the town of Marrow Point call each other:
[`examples/guesthouse_agentified/`](examples/guesthouse_agentified/),
[`examples/harbor_tours_agentified/`](examples/harbor_tours_agentified/) (made from
[`examples/harbor_tours/`](examples/harbor_tours/)) and
[`examples/marrow_point_pizza_agentified/`](examples/marrow_point_pizza_agentified/)
(made from [`examples/marrow_point_pizza/`](examples/marrow_point_pizza/)). Their READMEs
show how to serve all three on three host names.


## Infrastructure

Build tools and infrastructure for the agentic web: what will simplify the creation, deployment,
and discovery of agentic websites? What will make them more useful?


## Starter tools

These optional tools can help you get started quickly with building agentic web applications.

### Cognizant AI Lab’s Neuro SAN

[Neuro SAN Studio](https://github.com/cognizant-ai-lab/neuro-san-studio) is an open-source framework
for building and orchestrating multi-agent systems.
Try the [hosted version](https://neuro-san.evolution.ml/) with your own LLM keys. Use it to quickly prototype and test your agent networks.

### Mozilla’s Otari

[Otari](https://otari.ai) by Mozilla.ai is an open-source AI infrastructure platform and LLM gateway.
Use it to manage your LLM keys and build applications and agents with the models you choose,
including open-weight models, without being locked into a single provider.

Otari is optional. If you'd like to try it during the hackathon:
- **Claim your credits.** Hackathon registrants get free Otari credits (limited to the first 100
  registrants). Sign up at [otari.ai](https://otari.ai), then redeem the voucher code shared with
  registered participants on your [billing page](https://otari.ai/dashboard#/organization/billing).
- **Get help.** Join the [Mozilla OSAI Discord](https://discord.gg/AzMfpN3VNS), select the
  `agentic-hackathon` role in Channels & Roles, and ask in `#otari-ai`. The Otari developers are there.
- **Share feedback.** Post in `#otari-ai` or
  [open an issue](https://github.com/mozilla-ai/otari/issues). Issues and pull requests on the
  [Otari repo](https://github.com/mozilla-ai/otari) are welcome, and so are stars.

An open agentic website can use Otari as its LLM router:
- **Hosted Otari** (`https://api.otari.ai/api/v1`, or `https://eu.api.otari.ai/api/v1` for
  an EU account) allows calls from the browser, so a static site can use it with your
  Otari API key. Some models fail on every request, so start with
  `alibaba/qwen3.8-flash`. The examples in this repo use hosted Otari with that model by
  default.
- **Self-hosted Otari** works once you allow the site's origin in Otari's
  `cors_allow_origins`. It can also run local models through Ollama, with no provider key.

See [Using Otari](docs/providers/otari.md) for the steps, and
[LLM providers](docs/providers/providers.md) for other providers.

### NANDA’s Index agent registry

[Nanda Index](https://nandaindex.org/) lets agents find and verify one another across the network. Use it to find other agents, register your own agents, and verify the authenticity of agents you interact with.


## Testing

> [!NOTE]
> A validation script will be in this repo before the challenge deadline. Run it to
> check that your submission is compliant.

Until then, three Node.js scripts in
[`skills/agentify-website/scripts/`](skills/agentify-website/scripts/) test a site. They
need Node.js 22 or newer.

| Script | What it checks |
| --- | --- |
| `build_network.mjs --check` | Your own files, before you publish: the network parses and passes the runtime's validation, every agent can be reached, no TODO or placeholder is left, the manifest matches the network, partner calls would be allowed, and the published files are up to date. Without `--check`, it builds those files. |
| `serve_site.mjs` | Nothing by itself. It serves your site locally with the headers a real host should send, such as CORS on the public agent files, so the other checks and other sites can call it. |
| `check_partner.mjs` | A live site, the way a browser on another site sees it: each public file loads with the CORS header a browser needs, the network parses and passes validation, and the action bridge loads. It prints what that site's agents can reach, and what to add to your site to call it. Point it at your own site to see what partners see. |

Each script prints `WARNING:` and `ERROR:` lines that say what to fix, and exits with
code 1 when there is an error. `build_network.mjs` also checks the skill's own
conventions, so a site built another way may get messages the spec does not require.
`check_partner.mjs` reads only public files, so it works on any site.

### Example: the Marrow Point sites

From the repository root, check the harbor tours site's files:

```shell
node skills/agentify-website/scripts/build_network.mjs examples/harbor_tours_agentified/marrow_point_harbor_tours.hocon --manifest examples/harbor_tours_agentified/agent-manifest.json --check
```

It lists the network's agents, tools and partners, then ends with:

```text
OK: these files are up to date:
  - examples/harbor_tours_agentified/marrow_point_harbor_tours.network.json
  ...
```

Serve the three linked sites, each in its own terminal. They use three host names, so
their cookies stay apart:

```shell
node skills/agentify-website/scripts/serve_site.mjs examples/guesthouse_agentified --port 8080 --open-as 127.0.0.1
node skills/agentify-website/scripts/serve_site.mjs examples/harbor_tours_agentified --port 8081 --open-as localhost
node skills/agentify-website/scripts/serve_site.mjs examples/marrow_point_pizza_agentified --host ::1 --port 8083
```

Then check that the harbor tours site can call the guesthouse:

```shell
node skills/agentify-website/scripts/check_partner.mjs http://127.0.0.1:8080/tidewhistle_guesthouse --origin http://localhost:8081
```

```text
Read: http://127.0.0.1:8080/agent-manifest.json (200)
Read: http://127.0.0.1:8080/tidewhistle_guesthouse.network.json (200)
...
Add to this site:
  allowed_peers in agent-manifest.json: "http://127.0.0.1:8080"
  tools of the calling agent: "http://127.0.0.1:8080/tidewhistle_guesthouse"
  ...
OK: http://127.0.0.1:8080/tidewhistle_guesthouse can be called from http://localhost:8081.
```

Leave out `--origin` to check a site as any other site would see it.

## Documentation

### Definition of an agent in .json

An agent is defined as part of an **agent network**. The published `.network.json`
file is a data-only description of the agents, their instructions, and the
capabilities they can call. JSON is a valid serialization of the canonical HOCON
representation; published files must have includes and substitutions resolved and
must not depend on local files or environment variables. See
[sections 2.1–2.2 of the MVP specification](docs/worldwide_agentic_web_mvp_spec.md#21-minimum-network-content).

The network's top-level `tools` array contains its agent definitions. Each agent has:

| Field | Purpose |
| --- | --- |
| `name` | A unique name within the network, used by other agents to reference it. |
| `function.description` | A description of what the agent can do, so callers can decide when to use it. |
| `function.parameters` | A JSON Schema describing the inputs accepted when calling the agent. |
| `instructions` | Instructions for the LLM: its role, grounding, constraints, and how to fulfill requests. |
| `tools` | The agents or capabilities it can call, such as local agent names, published peer-network URLs, or MCP descriptors. An empty list declares no downstream references. |

This shortened example follows the structure of the
[pizza restaurant network](examples/marrow_point_pizza_agentified/little_oven_pizza.network.json).
It has one agent, with shortened instructions. Its `tools` are the network URLs of two
partner sites:

```json
{
  "metadata": {
    "description": "Ask about our pizzas, allergens, address and opening hours, fill your cart and place a demo order at Little Oven Pizza."
  },
  "tools": [
    {
      "name": "little_oven_assistant",
      "function": {
        "description": "Answers questions about Little Oven Pizza's pizzas, allergens, address and opening hours, fills the cart and places a demo pickup or delivery order for a visitor.",
        "parameters": {
          "type": "object",
          "properties": {
            "request": {
              "type": "string",
              "description": "The request in plain language."
            }
          },
          "required": ["request"]
        }
      },
      "instructions": "You are the assistant on the Little Oven Pizza website. Facts come only from website_* tool results and from this conversation. For a room or somewhere to stay, ask tidewhistle_guesthouse what it offers and how to book.",
      "tools": [
        "http://127.0.0.1:8080/tidewhistle_guesthouse",
        "http://localhost:8081/marrow_point_harbor_tours"
      ]
    }
  ]
}
```

The site's separate `agent-manifest.json` identifies the network through `name`,
selects its public entry point through `front_man` (here,
`little_oven_assistant`), and points `hocon` to the published `.network.json`
file. See the [pizza restaurant manifest](examples/marrow_point_pizza_agentified/agent-manifest.json).
The browser runtime loads this definition, runs the entry agent, and dispatches
its calls to the referenced agents, partner networks or tools.

The full pizza network also has shared instruction text in `commondefs`,
`llm_config`, a step limit (`max_steps`), a `cruse` block for forms and tables in
the chat, and `link_labels`, the partner names shown on the consent card. Model
settings are hints; when loading a peer network, the caller's active router and
model policy take precedence.

Instructions alone do not supply live data or execute website operations. The
pizza website registers its menu, cart and order functions as actions, and the
runtime offers them to the model as `website_*` tools. Action arguments are checked
against each action's schema, and placing an order requires browser confirmation. Published definitions and instructions are public: keep
credentials out of them and explicitly control any private context shared across
agent-site boundaries.

### HOCON reference

The full agent network HOCON reference is available in 
[this document](https://github.com/cognizant-ai-lab/neuro-san/blob/main/docs/agent_hocon_reference.md).


## Ideas

Discuss ideas for agentic web applications in the [Agentic Web Ideas](https://github.com/cognizant-ai-labs/agentic-web/discussions/categories/ideas) discussion category.


## FAQ

Short answers, with links to the docs that say more. See also the Frequently Asked
Questions on [The Open Agentic Web](https://worldwideagenticweb.org).

### The basics

#### What is an open agentic website?
A public website that publishes its own agent network as a JSON file, next to its pages,
with a runtime that runs that network in the visitor's browser. The visitor chats with it
and chooses the LLM and key. With the visitor's OK, one site's agents can call another
site's agents. See [What](#what) and the
[MVP specification](docs/worldwide_agentic_web_mvp_spec.md).

#### Do I need a server?
No, but nothing stops you from using one. Any static host works. Serve the public agent
files, such as `agent-manifest.json` and the `.network.json` file, with
`Access-Control-Allow-Origin: *`, so other sites' browsers can read them. Use HTTPS in
production. See
[spec section 3.3](docs/worldwide_agentic_web_mvp_spec.md#33-minimum-public-files) and
[Static hosting](skills/agentify-website/references/bundle_and_hosting.md#static-hosting).

A site can also run its own server next to those files, for example for bookings and
sign-in, for an MCP server its agents call, or for a proxy that pays for visitors' model
calls (see
[Paying for visitors' model calls](skills/agentify-website/references/bundle_and_hosting.md#paying-for-visitors-model-calls)).

#### Which spec version does the challenge use?
MVP Profile 0.2 or 0.3. They are the same apart from fixed links and typos.

#### Are my agents' instructions secret?
No. The network file is public by design, like page source. Keep prices, permissions and
anything confidential in your site's own code or on a server, and offer it through a site
action or authenticated MCP. See
[spec section 1.1](docs/worldwide_agentic_web_mvp_spec.md#11-intended-use-and-boundaries).

#### Does the assistant keep working after the tab closes?
No. The runtime lives as long as the page. Scheduled or background work needs a hosted
runtime or another service
([spec section 1.1](docs/worldwide_agentic_web_mvp_spec.md#11-intended-use-and-boundaries)).

### Models and keys

#### Who pays for the model calls?
By default, the visitor, with their own key. A site can pay instead: it points its
default router at a small proxy that adds the site's key, and sets
`llm_router.publisher_funded`. Visitors then chat with no key. See
[Paying for visitors' model calls](skills/agentify-website/references/bundle_and_hosting.md#paying-for-visitors-model-calls)
and [spec section 4](docs/worldwide_agentic_web_mvp_spec.md#4-tenet-three-pluggable-inference).

#### Which providers and models work?
Any OpenAI-compatible provider that accepts calls from a browser, such as OpenAI,
OpenRouter, hosted Otari and self-hosted LiteLLM. The examples use hosted Otari with
`alibaba/qwen3.8-flash`. Pick a model that makes tool calls. See
[LLM providers](docs/providers/providers.md) and [Using Otari](docs/providers/otari.md).

#### Does the visitor have to copy and paste a key?
No. In ⚙ AI model settings, **Connect with Otari** and **Connect with OpenRouter** sign
the visitor in and save a key made for that site. They work on an https site, or on the
visitor's own computer at `localhost`. See [Using Otari](docs/providers/otari.md#hosted-otari-otariai)
and [OpenRouter](docs/providers/providers.md#openrouter).

#### Where does the visitor's key go?
Only to the provider they chose. It stays in their browser and never goes into URLs,
prompts, action arguments, traces or requests to other sites. A partner site never gets
it. See [spec section 4](docs/worldwide_agentic_web_mvp_spec.md#4-tenet-three-pluggable-inference).
Other JavaScript on the same site can still read the key, so load few third-party scripts
and send a strict Content Security Policy. Visitors should use a key with a spending
limit.

### Building a site

#### How do I start?
Ask a coding agent to follow the
[agentify-website skill](skills/agentify-website/SKILL.md) on a site you already have. To
sketch the agents first, design a network in the hosted version of
[Neuro SAN Studio](#cognizant-ai-labs-neuro-san) and give it to the skill as a starting
point, as the [Quickstart](docs/quickstart.md) shows. The skill needs Node.js 22 or newer. [`examples/guesthouse/`](examples/guesthouse/) and
[`examples/guesthouse_agentified/`](examples/guesthouse_agentified/) show a site before
and after.

#### What if I can't change the site's code?
The skill can build a companion assistant instead: a separate static site that answers
from the public pages and links visitors to the real site to act. It can't see the
visitor's session or book for them. See
[Live URL mode](skills/agentify-website/references/live_url_mode.md).

#### How does the assistant do things on the page, like book a room?
The site registers its own functions as actions, each with a name, a description, an
input schema and an effect. The skill's runtime turns the ones listed in
`agent-manifest.json` under `actions.agentTools` into `website_<name>` tools the model
can call. See [Site actions](skills/agentify-website/references/site_actions.md) and the
[runtime README](skills/agentify-website/runtime/README.md).

#### When does the visitor have to confirm?
The site marks each action `read`, `write` or `irreversible`. Reads and undoable writes,
such as filling a basket, run at once. An irreversible action, such as a booking, waits
for the visitor to confirm. The model can't change these marks. When unsure, mark it
irreversible. See
[Choose the effect carefully](skills/agentify-website/references/site_actions.md#choose-the-effect-carefully).

#### How do I check my site?
A validation script will be in this repo before the challenge deadline. Until then, the
skill's scripts already catch a lot: see [Testing](#testing).
Community checkers such as Agent Atlas are on the
[Agentic Websites](docs/agentic_websites.md) list.

### Connecting sites

#### How does my agent call another site's agent?
List the partner's network URL in the agent's `tools`, and the partner's origin in
`allowed_peers`. The visitor agrees on a card before anything is sent. The partner's
network then runs in the visitor's browser, on the visitor's model and key. See
[Connect to other agent networks](#connect-to-other-agent-networks) and
[How a call works](skills/agentify-website/references/linking.md#how-a-call-works).

#### What does the partner site see?
Only the request text your agent writes. Not the chat, not the key, and not private
context (`sly_data`), which is denied across sites unless your network names a field.
See [spec section 5](docs/worldwide_agentic_web_mvp_spec.md#5-cross-cutting-security-and-privacy-requirements).

#### Can a partner use my site's functions?
Only the ones you share, and only with the sites you name. A site shares actions in
`bridge/bridge-actions.js`. A shared read runs in a hidden frame on your site, and a
shared write opens your site's own window, where the visitor confirms it. Never share a
write with `"*"`. See
[Let other sites call this site](skills/agentify-website/references/linking.md#let-other-sites-call-this-site).

#### How do I find other sites, and get mine listed?
Start with the [Agentic Websites](docs/agentic_websites.md) list, and directories such as
Agent Atlas and the [NANDA Index](#nandas-index-agent-registry). To be listed, open a pull
request that adds a row to `docs/agentic_websites.md`.

#### How does this relate to MCP, WebMCP and A2A?
MCP is the spec's baseline for tools and data: an agent can call an MCP server, and the
visitor approves a third-party server first. WebMCP integration is listed as future work
([spec section 7](docs/worldwide_agentic_web_mvp_spec.md#7-extensions-and-community-opportunities)),
and a site built with the skill can opt in: it then offers its own actions to the visitor's
browser agent through WebMCP, with irreversible ones confirmed on the page
([`references/webmcp.md`](skills/agentify-website/references/webmcp.md)). A site may also publish an A2A Agent Card
([spec section 3.3](docs/worldwide_agentic_web_mvp_spec.md#33-minimum-public-files)).

### Help

#### How do I get Otari credits, or help with Otari?
See [Mozilla's Otari](#mozillas-otari): the first 100 hackathon registrants get free
credits, and the Otari developers answer in `#otari-ai` on the Mozilla OSAI Discord.

#### Where do I ask a question or report a bug?
Ask in [Discussions](https://github.com/cognizant-ai-labs/agentic-web/discussions), share
ideas in the [Ideas](https://github.com/cognizant-ai-labs/agentic-web/discussions/categories/ideas)
category, and report bugs in [Issues](https://github.com/cognizant-ai-labs/agentic-web/issues).
