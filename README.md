# The Open Agentic Web

Create, own and connect agents on today's web. [The Open Agentic Web](https://worldwideagenticweb.org).

> [!IMPORTANT]
> This repository is actively evolving and its content changes frequently.
> Please check back often, and pull the latest version before you use anything here.

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
- a `runtime.js` file that can run the agent network in the browser
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

See [Agentic Websites](docs/agentic_websites.md) for examples and starting points that follow the Open Agentic Web principles.
Connect your agents to other [Agentic Websites](docs/agentic_websites.md) and grow the list!
Or use them as examples and starting points that follow the Open Agentic Web principles.

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

See the [Quickstart guide](docs/quickstart.md) to generate an agent network, build a website bundle, and test it with your own LLM provider API key.

## Agentifying an existing website

### Existing website

Start with the [simple pizza restaurant website](examples/pizza_restaurant/).
It is a standalone HTML, CSS and JavaScript example with a menu (including
ingredients and dietary information), a cart, and a demo pickup or delivery
checkout. It has no dependencies, backend or agent integration yet.

Run it from the repository root:

```shell
python -m http.server 8080 --directory ./examples/pizza_restaurant
```

Then open http://127.0.0.1:8080/. Add pizzas to the cart, adjust quantities,
choose pickup or delivery, and place a demo order to see its confirmation.
Orders stay in memory and no payment is collected or food ordered.

Use this as the existing website to agentify: ground menu answers in its menu
data and connect an agent's ordering tools to its cart and checkout logic.
See the [example's README](examples/pizza_restaurant/README.md) for the file layout.

### Agentified version

The [agentified pizza restaurant](examples/pizza_restaurant_agentified/) is a copy
of the existing website with the generated browser assistant embedded below its
menu and cart. The original website remains available on its own.  

To create this version,
[examples/pizza_restaurant_website_assistant.hocon](examples/pizza_restaurant_website_assistant.hocon)
and the generated [pizza_restaurant_website_assistant.network.json](examples/sites/pizza_restaurant_website_assistant_static/pizza_restaurant_website_assistant.network.json)
can be used as a starting point for the agent network.
Its agents need to be grounded in the restaurant's actual menu and cart next:

1. Copy the existing website:
   ```shell
   cp -R examples/pizza_restaurant examples/pizza_restaurant_agentified
   ```
2. Select components from
   [the generated static bundle](examples/sites/pizza_restaurant_website_assistant_static/):
   copy its `runtime/` directory, `agent-manifest.json`,
   `pizza_restaurant_website_assistant.network.json`, `links.json`, and
   `agent-mcp.json` into the new directory. Keep the restaurant's HTML and styles;
   the generated bundle's full-page `index.html` and `theme.css` are not needed.
3. Add a mount point below the restaurant checkout in `index.html` and load
   `site.js` as a module. In [site.js](examples/pizza_restaurant_agentified/site.js),
   call the copied runtime's `boot()` with that mount point and URLs relative to
   the current site. The runtime provides chat, BYOK settings, agent activity,
   structured action proposals, and a confirmation dialog.
4. Ground the network in the restaurant. Update the copied network's instructions
   to use actual menu and order data, remove instructions to invent demo results,
   and resolve the ordering and delivery specialists as local agents. `site.js`
   appends the current menu, cart, prices and latest local order to each agent
   invocation. All agents read the same state used by the restaurant UI.
5. Connect website operations. Export shared state and checkout functions from
   `script.js`; register `get_restaurant_state`, `add_to_cart`, `set_cart`, and
   `checkout_demo_order` in
   [restaurant-actions.js](examples/pizza_restaurant_agentified/restaurant-actions.js).
   Declare this module in the manifest's `actions` field and list the read/cart
   and checkout operations in `actions.agentTools`. The copied runtime's `runner.js` includes
   a bridge that exposes those operations as model-callable `website_*` tools.
   The agent calls `website_add_to_cart` to run the site's code immediately and
   receives a receipt with the updated cart. `website_checkout_demo_order` is
   also a callable tool, gated by the engine's confirmation callback. It opens
   a review dialog containing the cart, total and fulfillment details before
   calling the shared `submitOrder()` function. All arguments are schema-validated.
   CRUSE forms still collect missing details together: submitting an intake form
   passes its values to the agent, which then calls the checkout tool. Collecting
   answers and confirming order placement remain separate steps.
   The `render_cruse` tool attaches widgets directly to the response, preserving
   them through plain-text final answers and specialist handoffs. The response
   parser also accepts structured CRUSE JSON without a code fence.
   Cart changes appear in the existing cart; checkout uses the same validation
   and confirmation as the manual form. A cart version check rejects checkout
   if the cart has changed since checkout was prepared.
6. Serve the copy over HTTP (ES modules and runtime configuration need a server):
   ```shell
   python -m http.server 8080 --directory ./examples/pizza_restaurant_agentified
   ```
   Open http://127.0.0.1:8080/, scroll to **Ask Little Oven**, and expand
   **BYOK / router settings**. Enter your API key, model ID and a browser-accessible
   OpenAI-compatible router base URL, then click **Apply, save & reload**.
   The selected provider receives the chat and restaurant context; LLM calls use
   the customer's credentials.

Try asking “What are the vegetarian options?” or “Add two Margherita pizzas to
my cart.” The agent calls the cart tool and the visible cart updates. Then ask
for pickup or delivery checkout. Provide a name and, for delivery, an address; review the cart
and total in the checkout tool's confirmation dialog. Its receipt and the
restaurant confirmation show the resulting demo order.

This version supports menu questions, shared-cart updates, demo checkout and
the latest local order's `received` status. Orders still live only in page memory;
no food is ordered or payment collected. Delivery is a simulated choice, with
no external delivery delegation or live tracking. The copied `agent-mcp.json`
explicitly marks the public MCP facade unavailable: static hosting alone does
not provide a server for other websites to submit orders. See the
[agentified example's README](examples/pizza_restaurant_agentified/README.md)
for component details and verification instructions.

## Connect to other agent networks

To expend the capabilities of your agent networks, connect them to other [Agentic Websites](docs/agentic_websites.md).

> [!NOTE]
> TODO: Add a how-to


## Infrastructure

Build tools and infrastructure for the agentic web: what will simplify the creation, deployment,
and discovery of agentic websites? What will make them more useful?


## Starter tools

These optional tools can help you get started quickly with building agentic web applications.

### NANDA’s Index agent registry

[Nanda Index](https://nandaindex.org/) lets agents find and verify one another across the network. Use it to find other agents, register your own agents, and verify the authenticity of agents you interact with.

### Cognizant AI Lab’s Neuro SAN

[Neuro SAN Studio](https://github.com/cognizant-ai-lab/neuro-san-studio) is an open-source framework
for building and orchestrating multi-agent systems.
Try the [hosted version](https://neuro-san.evolution.ml/) with your own LLM keys. Use it to quickly prototype and test your agent networks.

### Mozilla’s Otari

[Otari](https://otari.ai) is an open-source LLM gateway. Use it to manage your LLM keys and connect to multiple LLM providers.

An open agentic website can use Otari as its LLM router:
- **Hosted Otari** (`https://api.otari.ai/api/v1`) blocks calls from the browser, so a
  static site can't use it.
- **Self-hosted Otari** works once you allow the site's origin in Otari's
  `cors_allow_origins`. It can also run local models through Ollama, with no provider key.

See [Using Otari](docs/providers/otari.md) for the steps, and
[LLM providers](docs/providers/providers.md) for other providers.


## Testing

> [!NOTE]
> TODO
Run the validation script to check your submission is compliant.

## Documentation

### HOCON reference

The agent network HOCON reference is available in 
[this document](https://github.com/cognizant-ai-lab/neuro-san/blob/main/docs/agent_hocon_reference.md).


## Hackathon

Check the official [hackathon](https://cognizant-agenticweb.devpost.com/) page for details about the Agentic Web Hackathon.

## Ideas

Discuss ideas for agentic web applications in the [Agentic Web Ideas](https://github.com/cognizant-ai-labs/agentic-web/discussions/categories/ideas) discussion category.


## FAQ

See the Frequently Asked Questions in [The Open Agentic Web](https://worldwideagenticweb.org).
