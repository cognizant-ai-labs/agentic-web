import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";
import { buildToolTable, dispatchToolCall, runAgent } from "../runtime/runner.js";
import { TraceBus } from "../runtime/trace.js";
import { Engine } from "../runtime/engine.js";
import { parseAgentResponse, consolidateIntakePresentations } from "../runtime/cruse.js";

// Minimal DOM fixture for application integration checks, not a browser emulator.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.handlers = {};
    this.value = "";
    this.disabled = false;
    this.required = false;
    this.validityMessage = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  setCustomValidity(message) { this.validityMessage = message; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(tag) {
    return this.children.flatMap(child => [
      ...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag),
    ]);
  }
  focus() { document.activeElement = this; }
}

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)]
  .map(match => [match[1], new Element(match[1])]));
globalThis.document = {
  activeElement: null,
  querySelector: selector => {
    assert(nodes[selector.slice(1)], `Missing element ${selector}`);
    return nodes[selector.slice(1)];
  },
  createElement: tag => new Element(tag),
};
const form = nodes["checkout-form"];
form.elements = { customerName: nodes["customer-name"], orderTime: nodes["order-time"] };
form.reportValidity = () => ![...Object.values(form.elements), nodes.address]
  .some(node => !node.disabled && (node.validityMessage || (node.required && !node.value)));
form.reset = () => {
  for (const node of [...Object.values(form.elements), nodes.address]) node.value = "";
  nodes.fulfillment.value = "pickup";
};
form.reset();
const { getRestaurantState, setCart } = await import("../script.js");
const { registerActions } = await import("../restaurant-actions.js");
const scope = { base: "http://localhost:8080", network: "pizza_restaurant_website_assistant" };
const registry = new ActionRegistry();
registerActions({ register: definition => registry.register(scope, definition) });
const catalog = registry.catalog(scope);
const component = (name, args) => ({
  kind: "action", action: catalog.find(entry => entry.name === name).ref, arguments: args,
});
const execute = (name, args, approve = true) => registry.execute(
  registry.prepare(component(name, args)), async () => approve, "test",
);
const checkout = overrides => ({
  customerName: "Alex", fulfillment: "pickup",
  expectedCartVersion: getRestaurantState().cartVersion, ...overrides,
});

test("copied network resolves all specialists locally", async () => {
  const config = JSON.parse(await readFile(new URL("../pizza_restaurant_website_assistant.network.json", import.meta.url)));
  const network = new AgentNetwork(config, scope.network);
  assert.deepEqual(validateNetwork(network).errors, []);
  assert.equal(network.findFrontMan(), "front_desk_coordinator");
  for (const ref of network.getAgentSpec("front_desk_coordinator").tools) {
    assert(network.getAgentSpec(ref), `Unresolved specialist ${ref}`);
  }
  assert(!JSON.stringify(config).includes("make up a realistic response"));
});

test("real registry and page share cart, validation, review and checkout", async () => {
  assert.equal(nodes["menu-items"].children.length, 4);
  assert.equal(catalog.length, 4);
  assert(catalog.every(action => action.availability === "local-only"));
  assert.equal(nodes["place-order"].disabled, true);

  const items = [{ id: "margherita", quantity: 2 }];
  assert.equal(await execute("set_cart", { items }, false), null);
  assert.equal(getRestaurantState().total, 0, "Declined review must not mutate state");
  assert.throws(() => registry.prepare(component("set_cart", {
    items: [{ id: "unknown", quantity: 1 }],
  })));
  assert.throws(() => registry.prepare(component("set_cart", {
    items: [{ id: "margherita", quantity: -1 }],
  })));
  const [cartReceipt] = await execute("set_cart", { items });
  assert.equal(cartReceipt.status, "succeeded");
  assert.equal(cartReceipt.result.total, 2400);
  assert.equal(nodes["cart-total"].textContent, "$24.00");

  const before = getRestaurantState();
  assert.throws(() => setCart([{ id: "vegan", quantity: 1 }, { id: "vegan", quantity: 2 }]));
  assert.deepEqual(getRestaurantState(), before, "Invalid cart must be atomic");
  const staleCheckout = checkout();
  const increment = nodes["cart-items"].querySelectorAll("button")
    .find(button => button.getAttribute("aria-label") === "Increase Margherita quantity");
  increment.handlers.click();
  assert.equal(getRestaurantState().total, 3600, "Manual controls share the assistant cart");
  const [staleReceipt] = await execute("checkout_demo_order", staleCheckout);
  assert.notEqual(staleReceipt.status, "succeeded");
  assert.match(staleReceipt.error, /cart changed/);
  assert.equal(getRestaurantState().lastOrder, null);

  for (const overrides of [
    { customerName: "   " }, { fulfillment: "delivery", address: " " }, { orderTime: "25:00" },
  ]) {
    const [receipt] = await execute("checkout_demo_order", checkout(overrides));
    assert.notEqual(receipt.status, "succeeded");
    assert.equal(getRestaurantState().total, 3600);
  }
  const order = checkout({ fulfillment: "delivery", address: "123 Main Street", orderTime: "18:00" });
  assert.equal(await execute("checkout_demo_order", order, false), null);
  assert.equal(getRestaurantState().lastOrder, null);
  const [receipt] = await execute("checkout_demo_order", order);
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.result.status, "received");
  assert.equal(receipt.result.total, 3600);
  assert.equal(receipt.result.items[0].quantity, 3);
  assert.equal(receipt.result.simulated, true);
  assert.match(nodes["order-summary"].textContent, /Delivery to 123 Main Street, 18:00/);
  assert.equal(nodes["order-total"].textContent, "Total: $36.00");
  assert.equal(nodes.confirmation.hidden, false);
  assert.equal(nodes["place-order"].disabled, true);
  assert.equal(getRestaurantState().total, 0);
  const [replay] = await execute("checkout_demo_order", order);
  assert.notEqual(replay.status, "succeeded", "Old checkout must not create a duplicate order");

  await execute("set_cart", { items: [{ id: "vegan", quantity: 1 }] });
  form.elements.customerName.value = "<img src=x onerror=alert(1)>";
  form.handlers.submit({ preventDefault() {} });
  assert.equal(getRestaurantState().lastOrder.total, 1300);
  assert.equal(getRestaurantState().lastOrder.fulfillment, "pickup");
  assert.equal(getRestaurantState().lastOrder.customerName, "<img src=x onerror=alert(1)>");
  assert.equal(nodes["order-summary"].children.length, 0, "Customer data must remain text");
  const [stateReceipt] = await execute("get_restaurant_state", {});
  assert.equal(stateReceipt.result.lastOrder.orderId, getRestaurantState().lastOrder.orderId);
});

test("model tool calls execute the cart code and return receipts before the answer", async () => {
  setCart([{ id: "vegan", quantity: 1 }]);
  const config = JSON.parse(await readFile(new URL("../pizza_restaurant_website_assistant.network.json", import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url)));
  const network = new AgentNetwork(config, scope.network);
  let modelCalls = 0;
  const ctx = {
    network, manifest, actions: registry, baseOrigin: scope.base,
    displayOrigin: "localhost:8080", trace: new TraceBus(),
    isTop: true, frontMan: "front_desk_coordinator", history: [],
    llm: { async chat({ tools, messages }) {
      modelCalls++;
      assert(tools.some(tool => tool.function.name === "website_add_to_cart"));
      assert(!tools.some(tool => tool.function.name === "website_checkout_demo_order"));
      if (modelCalls === 1) return {
        content: "", toolCalls: [{
          id: "add-pizza", type: "function",
          function: { name: "website_add_to_cart", arguments: JSON.stringify({ id: "margherita", quantity: 2 }) },
        }],
      };
      const receipt = JSON.parse(messages.find(message => message.role === "tool").content);
      assert.equal(receipt.status, "succeeded");
      assert.equal(receipt.result.total, 3700);
      assert.equal(nodes["cart-total"].textContent, "$37.00");
      return { content: "Added two Margherita pizzas. Your cart total is $37.00.", toolCalls: [] };
    } },
  };
  const result = await runAgent(ctx, "front_desk_coordinator", "Add two Margherita pizzas", null, []);
  assert.equal(modelCalls, 2);
  assert.match(result.text, /Added two/);
  assert.deepEqual(getRestaurantState().cart, [
    { id: "vegan", quantity: 1 }, { id: "margherita", quantity: 2 },
  ]);

  const { toolByName } = await buildToolTable(ctx, network.getAgentSpec("ordering_checkout_specialist"), [], null);
  const add = toolByName.get("website_add_to_cart");
  assert(add, "Specialists must have access to cart tools too");
  const before = getRestaurantState();
  await assert.rejects(dispatchToolCall(ctx, add, { id: "unknown", quantity: 1 }, null, []));
  assert.deepEqual(getRestaurantState(), before);
  // Checkout cannot be exposed or executed without a confirmation handler.
  const table = await buildToolTable(ctx, network.getAgentSpec("front_desk_coordinator"), [], null);
  assert(!table.toolByName.has("website_checkout_demo_order"));
  await assert.rejects(dispatchToolCall(ctx, {
    kind: "website", ref: catalog.find(action => action.name === "checkout_demo_order").ref,
  }, checkout(), null, []));
  assert.deepEqual(getRestaurantState(), before);
});

test("agent checkout uses the engine confirmation gate and matches manual checkout", async () => {
  const config = JSON.parse(await readFile(new URL("../pizza_restaurant_website_assistant.network.json", import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url)));
  const items = [{ id: "garden", quantity: 2 }];
  const details = { customerName: "Sam", fulfillment: "delivery", address: "42 Oak Road", orderTime: "18:30" };
  const prepareCart = () => {
    setCart(items);
    form.elements.customerName.value = details.customerName;
    form.elements.orderTime.value = details.orderTime;
    nodes.fulfillment.value = details.fulfillment;
    nodes.fulfillment.handlers.change();
    nodes.address.value = details.address;
    nodes["checkout-error"].textContent = "Old validation error";
  };
  const pageSnapshot = () => ({
    cart: getRestaurantState().cart,
    total: nodes["cart-total"].textContent,
    empty: nodes["empty-cart"].hidden,
    disabled: nodes["place-order"].disabled,
    name: form.elements.customerName.value,
    address: nodes.address.value,
    method: nodes.fulfillment.value,
    time: form.elements.orderTime.value,
    deliveryFields: nodes["delivery-fields"].hidden,
    error: nodes["checkout-error"].textContent,
    confirmation: nodes.confirmation.hidden,
    orderTotal: nodes["order-total"].textContent,
    orderItems: nodes["order-items"].children.map(node => node.textContent),
    focused: document.activeElement === nodes.confirmation,
  });
  prepareCart();
  form.handlers.submit({ preventDefault() {} });
  const manualOrder = getRestaurantState().lastOrder;
  const manualPage = pageSnapshot();

  const callCheckout = async (confirm, args = checkout(details)) => {
    const engine = new Engine({ originUrl: scope.base });
    engine.actions = registry;
    if (confirm) engine.onActionConfirm = confirm;
    let calls = 0;
    let receipt;
    engine.top = {
      network: new AgentNetwork(config, scope.network), base: scope.base, manifest,
      llm: { async chat({ tools, messages }) {
        calls++;
        assert(tools.some(tool => tool.function.name === "website_checkout_demo_order"));
        if (calls === 1) return {
          content: "", toolCalls: [{ id: "checkout", type: "function", function: {
            name: "website_checkout_demo_order", arguments: JSON.stringify(args),
          } }],
        };
        receipt = JSON.parse(messages.find(message => message.role === "tool").content);
        return { content: `Checkout result: ${receipt.status}`, toolCalls: [] };
      } },
    };
    await engine.runTurn("Place my demo delivery order");
    assert.equal(calls, 2);
    return receipt;
  };
  prepareCart();
  const beforeReview = pageSnapshot();
  const previousOrder = getRestaurantState().lastOrder;
  assert.equal((await callCheckout()).status, "cancelled", "Default engine must fail closed");
  assert.deepEqual(pageSnapshot(), beforeReview);
  let reviews = 0;
  const receipt = await callCheckout(async plan => {
    reviews++;
    assert.deepEqual(pageSnapshot(), beforeReview, "Do not place the order before confirmation");
    assert.equal(plan[0].action, "checkout_demo_order");
    assert.equal(plan[0].effect, "irreversible");
    assert.equal(plan[0].arguments.customerName, "Sam");
    return true;
  });
  assert.equal(reviews, 1);
  assert.equal(receipt.status, "succeeded");
  assert.notEqual(receipt.result.orderId, previousOrder.orderId);
  assert.deepEqual({ ...receipt.result, orderId: manualOrder.orderId }, manualOrder);
  assert.deepEqual(pageSnapshot(), manualPage, "Manual and agent checkout must leave identical page state");
  assert(nodes["order-summary"].textContent.includes(receipt.result.orderId));

  prepareCart();
  const beforeDecline = getRestaurantState();
  assert.equal((await callCheckout(async () => false)).status, "cancelled");
  assert.deepEqual(getRestaurantState(), beforeDecline);
  const stale = await callCheckout(async () => {
    setCart([{ id: "vegan", quantity: 1 }]);
    return true;
  });
  assert.notEqual(stale.status, "succeeded");
  assert.match(stale.error, /cart changed/);
  assert.deepEqual(getRestaurantState().lastOrder, beforeDecline.lastOrder);
});

test("a consolidated CRUSE intake form survives tool exposure and feeds checkout", async () => {
  setCart([{ id: "margherita", quantity: 2 }]);
  const config = JSON.parse(await readFile(new URL("../pizza_restaurant_website_assistant.network.json", import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url)));
  const engine = new Engine({ originUrl: scope.base });
  engine.actions = registry;
  const values = { customerName: "Taylor", fulfillment: "delivery", address: "12 Elm Street", orderTime: "19:00" };
  let calls = 0;
  let reviews = 0;
  engine.onActionConfirm = async () => { reviews++; return true; };
  engine.top = {
    network: new AgentNetwork(config, scope.network), base: scope.base, manifest,
    llm: { async chat({ messages, tools }) {
      const prompt = messages[0].content;
      assert(prompt.includes("ONE consolidated"));
      assert(prompt.includes("CRUSE forms remain available"));
      assert(!prompt.includes("No browser actions are registered"));
      assert(tools.some(tool => tool.function.name === "website_checkout_demo_order"));
      calls++;
      if (calls === 1) return {
        content: 'Your total is $24.00. Please fill in the remaining details.\n```cruse-ui\n' + JSON.stringify({
          version: 1, components: [{
            kind: "form", id: "order-details", title: "Order details",
            schema: {
              type: "object", properties: {
                customerName: { type: "string", title: "Your name" },
                fulfillment: { type: "string", enum: ["pickup", "delivery"],
                  "x-ui": { widget: "radio", enumLabels: ["Pickup", "Delivery"] } },
                address: { type: "string", title: "Delivery address (only for delivery)" },
                orderTime: { type: "string", format: "time", title: "Preferred time today",
                  description: "Leave empty for ASAP, or choose a time today." },
              }, required: ["customerName", "fulfillment"],
            }, submitLabel: "Review order",
          }],
        }) + '\n```', toolCalls: [],
      };
      if (calls === 2) {
        const input = messages.filter(message => message.role === "user").at(-1).content;
        const interaction = JSON.parse(input.split("CRUSE interaction: ")[1]);
        assert.deepEqual(interaction.values, values);
        return { content: "", toolCalls: [{
          id: "submit-collected-order", type: "function", function: {
            name: "website_checkout_demo_order",
            arguments: JSON.stringify({ ...interaction.values, expectedCartVersion: getRestaurantState().cartVersion }),
          },
        }] };
      }
      const receipt = JSON.parse(messages.find(message => message.role === "tool").content);
      assert.equal(receipt.status, "succeeded");
      return { content: `Demo order ${receipt.result.orderId} received.`, toolCalls: [] };
    } },
  };
  const first = await engine.runTurn("I would like to check out");
  assert.equal(first.presentation.components.length, 1);
  const intake = first.presentation.components[0];
  assert.equal(intake.kind, "form");
  assert.equal(Object.keys(intake.schema.properties).length, 4);
  assert.deepEqual(intake.schema.properties.fulfillment["x-ui"], {
    widget: "radio", enumLabels: ["Pickup", "Delivery"],
  });
  assert.equal(intake.schema.properties.orderTime.format, "time");
  assert(!intake.submit, "Intake supplies answers without executing an action");
  assert.equal(reviews, 0);
  assert.equal(getRestaurantState().total, 2400);
  const second = await engine.runTurn("Review order", { interaction: {
    turnId: first.turnId, componentId: intake.id, kind: "form", values,
  } });
  assert.equal(reviews, 1);
  assert.equal(calls, 3);
  assert.equal(getRestaurantState().lastOrder.customerName, "Taylor");
  assert.equal(getRestaurantState().lastOrder.address, "12 Elm Street");
  assert.equal(getRestaurantState().total, 0);
  assert(second.text.includes(getRestaurantState().lastOrder.orderId));
});

test("render_cruse tool widgets reach the UI event even when final text has no fence", async () => {
  const config = JSON.parse(await readFile(new URL("../pizza_restaurant_website_assistant.network.json", import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url)));
  const presentation = { version: 1, components: [{
    kind: "form", id: "intake", title: "Order details",
    schema: { type: "object", properties: {
      customerName: { type: "string", title: "Your name" },
      fulfillment: { type: "string", enum: ["pickup", "delivery"] },
    }, required: ["customerName", "fulfillment"] },
  }] };
  const engine = new Engine({ originUrl: scope.base });
  engine.actions = registry;
  let calls = 0;
  engine.top = {
    network: new AgentNetwork(config, scope.network), base: scope.base, manifest,
    llm: { async chat({ tools, messages }) {
      assert(tools.some(tool => tool.function.name === "render_cruse"));
      calls++;
      if (calls === 1) return { content: "", toolCalls: [{
        id: "render-intake", type: "function", function: {
          name: "render_cruse", arguments: JSON.stringify({ presentation }),
        },
      }] };
      assert.equal(JSON.parse(messages.find(message => message.role === "tool").content).status, "accepted");
      return { content: "Fill in your order details below.", toolCalls: [] };
    } },
  };
  let result;
  for await (const event of engine.streamTurn("Help me check out")) {
    if (event.type === "turn.completed") result = event.result;
  }
  assert.equal(result.text, "Fill in your order details below.");
  assert.deepEqual(result.presentation, presentation);
  assert.equal(calls, 2);
});

test("structured CRUSE objects and compatible child intake forms are preserved", () => {
  const form = (id, properties) => ({ kind: "form", id, title: "Order details",
    schema: { type: "object", properties, required: Object.keys(properties) } });
  const first = { version: 1, components: [form("name", { customerName: { type: "string" } })] };
  const second = { version: 1, components: [form("delivery", {
    fulfillment: { type: "string", enum: ["pickup", "delivery"] },
    address: { type: "string" },
  })] };
  for (const raw of [
    first, JSON.stringify(first), { cruse: 1, text: "Please fill this in.", presentation: first },
    { Name: "ordering", Mode: "Fulfill", Response: { text: "Details", presentation: first } },
  ]) {
    assert.deepEqual(parseAgentResponse(raw).presentation, first);
  }
  const combined = consolidateIntakePresentations([first, second]);
  assert.equal(combined.components.length, 1);
  assert.deepEqual(Object.keys(combined.components[0].schema.properties), ["customerName", "fulfillment", "address"]);
  assert.deepEqual(combined.components[0].schema.required, ["customerName", "fulfillment", "address"]);
  assert.deepEqual(Object.keys(first.components[0].schema.properties), ["customerName"], "Do not mutate child output");
});

test("coordinator retains child widgets when it answers in plain text", async () => {
  const config = JSON.parse(await readFile(new URL("../pizza_restaurant_website_assistant.network.json", import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url)));
  let calls = 0;
  const ctx = {
    network: new AgentNetwork(config, scope.network), manifest, actions: registry,
    baseOrigin: scope.base, displayOrigin: "localhost:8080", trace: new TraceBus(),
    isTop: true, frontMan: "front_desk_coordinator", history: [],
    llm: { async chat({ messages }) {
      calls++;
      if (calls === 1) return { content: "", toolCalls: [{ id: "ask-ordering", type: "function", function: {
        name: "ordering_checkout_specialist", arguments: JSON.stringify({ inquiry: "Collect order details", mode: "Fulfill" }),
      } }] };
      if (calls === 2) return { content: "", toolCalls: [{ id: "child-ui", type: "function", function: {
        name: "render_cruse", arguments: JSON.stringify({ presentation: { version: 1, components: [{
          kind: "form", id: "child-intake", schema: { type: "object", properties: {
            customerName: { type: "string" }, fulfillment: { type: "string", enum: ["pickup", "delivery"] },
          }, required: ["customerName", "fulfillment"] },
        }] } }),
      } }] };
      return { content: "Please provide your details below.", toolCalls: [] };
    } },
  };
  const result = await runAgent(ctx, "front_desk_coordinator", "Help me order", null, []);
  assert.equal(calls, 4);
  assert.equal(result.presentation.components.length, 1);
  assert.equal(result.presentation.components[0].id, "child-intake");
});
