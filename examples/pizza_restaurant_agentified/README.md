# Little Oven Pizza with a browser assistant

A copy of [Little Oven Pizza](../pizza_restaurant/) with the browser runtime,
chat, BYOK settings and action review UI from the
[generated static bundle](../sites/pizza_restaurant_website_assistant_static/).
The original menu, cart and manual checkout still work alongside the assistant.

## Run

From the repository root:

```shell
python -m http.server 8080 --directory ./examples/pizza_restaurant_agentified
```

Open http://127.0.0.1:8080/. Use HTTP rather than opening `index.html` as a file:
the assistant loads ES modules and fetches its configuration.

Scroll to **Ask Little Oven**, open **BYOK / router settings**, enter an API key,
model ID and OpenAI-compatible router base URL, and select **Apply, save & reload**.
The router must allow requests from the browser through CORS. The generated
runtime manages saved provider settings in the browser; no key is included in
the example source. Chat and restaurant context go to the provider you select.
The assistant requires a configured provider; the manual website does not.

## Try it

1. Ask “What are the vegetarian options?” or “Which pizza is made without dairy?”
   Answers use the actual menu, including the shared-kitchen note.
2. Ask “Add two Margherita pizzas to my cart.” The agent calls
   `website_add_to_cart`, which runs the site's cart code immediately. Check that
   the visible cart shows $24.00. Existing items remain in the cart.
3. Adjust a quantity with the manual buttons, then ask the assistant about your
   cart. Its next invocation includes the updated state.
4. Ask to check out for pickup or delivery. Supply a name, an address for delivery,
   and optionally a time today. The assistant guides you through the existing
   website checkout components or asks for missing details in chat, carrying
   forward answers already given. The optional native time picker accepts a
   time today; leave it empty for ASAP. The assistant uses
   `website_checkout_demo_order` to submit an order through its tools.
   Confirm its browser review dialog after checking the cart and total. The cart clears and the site
   displays the same confirmation it uses for manual orders.
5. Ask about your latest order's status. It reports the local simulated order as
   `received`; it cannot look up orders from other sessions.

Cart tool calls execute immediately and return local receipts to the model, so
it can confirm the actual updated quantities and total. The checkout tool opens
an explicit browser confirmation dialog before running the shared `submitOrder`
function. Success clears the cart, resets the checkout form and displays the same
order confirmation as clicking **Place demo order**. Declining checkout review does not place an order.
Checkout includes `expectedCartVersion`; changes to the cart invalidate an old
checkout request, so the customer must review the updated cart before retrying.

## Components

Copied unchanged from the generated bundle:

- `links.json`: empty published peer links.
- `agent-mcp.json`: explicitly declares that a public MCP facade is unavailable.

Adapted from that bundle:

- `runtime/`: the complete browser dependency tree. `runner.js` adds a small
  bridge from model tool calls to the site's action registry. Only local operations
  listed in `actions.agentTools` are exposed. They use the registry's schema
  validation and receipt handling. Calls execute sequentially. Irreversible
  checkout requires the host confirmation callback, which `engine.js` passes
  through from `onActionConfirm`. Without approval, no order is submitted.
  `runner.js` also exposes `render_cruse`, so the model can attach widgets
  through a real tool call instead of relying on fenced JSON in its final text.
  These widgets survive plain-text final answers and specialist handoffs.
  `cruse.js` accepts unfenced structured responses and combines compatible
  child intake forms when the coordinator does not provide its own composition.
  `ui.js` supports native time inputs and friendly enum labels, with accessible
  fieldset groups for radio choices. Other runtime files remain unchanged.
- `agent-manifest.json`: restaurant branding, supported sample queries, local
  specialist links, the `actions.module` registration entry, and an explicit
  `actions.agentTools` list for state reads, cart changes and confirmed checkout.
- `pizza_restaurant_website_assistant.network.json`: the coordinator and menu,
  ordering and delivery specialists, with concise instructions to read current
  website information and use existing website components and tools. Menu facts,
  implementation recipes and generated UI examples are kept out of the prompts.
  The example uses page-local tools. No unresolved remote specialist links
  are required.
- `site.js`: adapts the generated `boot()` pattern to mount the assistant inside
  the restaurant. It enriches each local agent specification with a fresh
  `getRestaurantState()` snapshot, including the menu, cart, version and latest
  order. It also adds the actual cart and formatted total to checkout review.

Restaurant integration:

- `index.html` and `styles.css`: retain the restaurant and add a responsive
  assistant section using the runtime's header, chat and agent slots. The
  generated full-page HTML and global theme stylesheet are omitted.
- `script.js`: keeps the menu and cart rendering and exports
  `getRestaurantState()`, `setCart(items)` and `submitOrder(details)`. Both manual
  and assistant checkout use `submitOrder`, including validation and rendering.
- `restaurant-actions.js`: registers four page-local capabilities with explicit
  schemas and effects. `add_to_cart` increments one item's quantity and preserves
  existing items; `set_cart` replaces the entire cart. These are callable model
  tools, along with `get_restaurant_state` and `checkout_demo_order`. Checkout
  uses the cart's current version and requires customer review before executing.

## Verification

With Node.js 22 or newer, run the dependency-free integration checks:

```shell
node --test examples/pizza_restaurant_agentified/tests/restaurant.test.mjs
```

These exercise the real action registry, argument schemas, confirmation boundary,
shared cart, checkout receipts, validation, stale proposals and network structure.
A regression check runs the actual agent loop with a scripted model tool response,
verifying that the cart DOM updates and the next model call receives its receipt.
Another runs checkout through the actual engine and compares its resulting page
state to manual checkout, including declined confirmation and stale-cart checks.
A CRUSE regression check verifies that a combined intake form is preserved and
its submitted values can feed the checkout tool on the next turn.
Additional checks cover widget tool calls reaching the final UI stream event,
structured responses without fences, and preservation of specialist widgets
when the coordinator answers in plain text.
They do not call a paid LLM. Use the steps above to check a live provider and the UI.

## Limits

All prices are USD integer cents. All pizzas are 12 inches. No extra fees, taxes,
coupons, size choices or custom toppings are implemented. The kitchen is shared.

Orders, customer details and cart state stay in page memory and disappear on
refresh. Orders are simulated; there is no payment or real fulfillment. Delivery
does not call an external service and no tracking progress is generated.

Actions operate on the current page, so they are local-only. The public manifest
describes the network, but this example provides no public MCP server or
cross-site ordering backend. Deploying such a service requires a real backend
and appropriate access controls. If deploying the static files, configure MIME
types, provider CORS and runtime security headers as described in the source
bundle's [hosting notes](../sites/pizza_restaurant_website_assistant_static/STATIC_HOSTING.md).
