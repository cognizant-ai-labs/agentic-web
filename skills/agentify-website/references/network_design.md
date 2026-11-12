# Designing the agent network

Read this before writing the `.hocon`. The goal is a network that answers from the
site's real data, does what the site can really do, and costs the visitor as few model
calls as possible. The visitor pays for every call with their own key.

## Start from the capability inventory, not from a template

List what the site has before naming any agent:

| Kind | Questions to answer | Example (pizza site) |
| --- | --- | --- |
| Data | What does the site know? Where is it defined? Which records belong to other people? | `menu` array in `script.js`: id, name, price, ingredients, dietary, allergens |
| State | What changes while a visitor uses the page? | cart (id → quantity), latest order |
| Operations | What can a visitor do? Which function or form does it? Can they undo it? | add/remove items (undo: yes), place order (undo: no) |
| Not supported | What would a visitor expect that the site does not do? | sizes, coupons, fees, tracking, real delivery |
| External | What belongs to another service? | delivery partner, payments |

Each operation becomes one site action. Each piece of data is reached through a read
action. Unsupported features go into the grounding rules so the agent says so plainly.
External services become an MCP URL, a partner site's network or a plain "not available
here" (see "External capabilities" below).

## How many agents

Start with **one front agent** that owns every `website_*` tool. Add another agent only
when it passes at least one of these tests:

1. **Separate knowledge.** It needs a large body of reference text (policies, a manual, a
   long catalog) that the front agent does not need for most turns.
2. **Separate system.** It calls a different MCP server.
3. **Separate workflow.** It runs a multi-step process with its own rules (for example a
   returns flow with eligibility checks), and mixing those rules into the front agent
   would make its instructions confusing.

Splitting by business department ("menu", "ordering", "delivery") is not a reason on
its own. Each delegation adds at least one model call for the specialist, plus one more
for each tool the specialist uses. The specialist also cannot see the conversation: only
the top front agent gets the chat history (`runtime/runner.js`, `runAgentManual`), so a
specialist sees only the `request` text it is sent. Most small sites need one or two agents.

Runtime limit: the patched runtime offers **every** `website_*` tool to **every** agent
(`runtime/runner.js`, `buildToolTable`). A specialist is therefore scoped only by its
instructions. Tell each agent which tools are its job, and keep write and irreversible
tools with the front agent unless there is a clear reason not to.

## Delegation without AAOSA

AAOSA (the `Determine` / `Fulfill` protocol from Neuro SAN's `aaosa.hocon`) tells the
front agent to ask every specialist whether it is relevant before asking it to act. In a
browser network that roughly doubles the model calls per turn. Use plain delegation:

- Give each agent a `function` with one required string parameter named `request`. The
  runner passes `request`, `input` or `input_string` to the called agent as plain text;
  any other name, such as `inquiry`, arrives as raw JSON (`runtime/runner.js`, `argsToText`).
- In the front agent's instructions, say which agent handles which job, and tell it to
  pass along details the visitor already gave, because the specialist cannot see the chat.
- Tell specialists that their answer goes to the front agent, not the visitor, and to
  return facts and missing details as short text.

Use AAOSA only when there are several specialists whose jobs overlap so much that the
front agent cannot tell from their descriptions which one to call.

## Grounding rules

- No `demo_mode`, and no instruction to "make up a realistic response". `build_network.mjs`
  fails the build when it finds either.
- Facts come from `website_*` tool results and from the conversation only. Do not copy
  catalog facts (prices, ingredients, "the Garden Veggie is gluten free") into
  instructions: they drift from the site's code. Let the agent read them.
- Facts that appear only in the page's HTML (sizes, fees, hours, policies) also go
  through the read action. See "Expose page-only facts" in `site_actions.md`.
- Do not paste the page state into every prompt. The agent calls the read action when it
  needs the state, which keeps prompts small and the data current.
- Report outcomes from receipts only: `succeeded` (check `result.ok`), `cancelled` (the
  visitor declined) or `unknown` (may have happened; never retry). A plain
  "Error from tool" message means nothing ran: the arguments failed the schema, or
  `site.js` found that the site would refuse.
- List what the site cannot do, so the agent says it plainly instead of improvising.

## Writing instructions

Shared text goes once into `commondefs.replacement_strings` and is used as a placeholder,
such as `{grounding_rules}`. The browser expands each placeholder once: a replacement
string must not contain another `{placeholder}`.

Keep each agent's expanded instructions under about 5,000 characters (`build_network.mjs`
warns above that). In the front agent, the template's `{grounding_rules}` without its
TODO line, `{cruse_rules}`, `{peer_rules}` and `{partner_rules}` already use about 3,500
of them, or about 2,850 without `{partner_rules}`. Everything else shares the rest,
about 1,450 or 2,150: the first sentence, the list of what the site cannot do, and every
"How to work" line. The template's own words in those lines count: about 250 in the
irreversible action's line. The runtime appends about 2,000 more: CRUSE guidance
(`runtime/cruse.js`, `agentPresentationContext`) and a note on `website_*` tools
(`runtime/runner.js`, `runAgent`). Do not repeat that guidance; the template's
`{cruse_rules}` adds the component shapes and two short rules.

Each model call also sends every `website_*` tool's description and input schema, and
`build_network.mjs` does not count them. They can be longer than the instructions: in the
agentic-web repository's `examples/guesthouse_agentified`, its tool definitions are about
1.7 times the size of its instructions. Keep each description to what the model
needs to choose and call the tool, and do not add an action whose job another action
already does. The template's read-tool test prints what one model call sends: the system
prompt with the runtime's notes, and all tool definitions.

A good front agent's instructions have these parts, in this order:

1. One sentence: who it helps, on which site, with what. Name the kinds of things the site
   offers in plain words, such as "bike rentals, guided rides and repairs", with no
   prices, times or other details that change. When another agent site runs this
   network, it learns little more than this ("Site tools" in `linking.md`).
2. `{grounding_rules}`.
3. "How to work": one line per tool or specialist, saying when to call it and with what.
4. `{partner_rules}`, only when the agent calls partner sites.
5. `{cruse_rules}`. Only the front agent needs these: only its presentation is shown.
6. `{peer_rules}`.

Some rules on the site decide what to pass to an operation, such as who counts as a guest
or what goes in a notes field. Tell the agent to read them before the operation, not only
when the visitor asks. If a separate read returns them, tell the agent to make that read
in the same reply as its state read, which costs no extra round trip. The model writes
every call in a reply before the first one runs, so the operation goes in a later reply.

Some rules depend on what only the visitor tells the agent, such as a child's age against
a trip's minimum age, so the site's own check cannot apply them. Return the rule with each
result it affects, such as the trip's age limit with each departure. Say in the read's
description what the site does not check, and add a "How to work" line that tells the
agent to apply the rule before it offers or adds a result.

Tool results last one turn: the next turn gets the visitor's messages and the agent's
answers, not the results (`runtime/engine.js`, `runTurn`). So a version or fee read in an
earlier turn is gone when the visitor says yes. Tell the agent to call that read again in
the turn of the irreversible call, and pass the value from the new result. The template's
line for the irreversible action already says this.

Name tools exactly as the model sees them: `website_<action name>`.
`build_network.mjs --manifest` checks that every `website_*` name in the instructions is
listed in `actions.agentTools`.

## External capabilities

- **A partner with only a normal website.** Do not add an agent or tool for it. List the
  service in the grounding rules as something the site cannot do. Put the partner's link
  and phone number in the page facts, so the agent can point visitors there. Read the
  link's `href`, because `textContent` leaves it out.
- **Another agent site.** If it publishes an agent network and the user wants the
  assistant to ask it, call it as a partner (`linking.md`): its full network URL in
  `tools`. Never add a link slot: it makes the chat ask the visitor for a URL. Otherwise
  treat it as a normal website.
- **An MCP server.** Use `{"url": "https://tools.example/mcp", "tools": ["search"]}` in
  `tools`. In a static bundle the browser calls it directly, so it must allow CORS. List
  the MCP server's origin in `allowed_peers`: with the closed policy, the runtime refuses
  every other origin this network asks for.
- **Python or toolbox tools** (`web_fetch`, `class`, `toolbox`) do not run in a static
  bundle. The build fails on them.

## Sample queries

Put four to six in `metadata.sample_queries`, and copy them to the manifest.
`build_network.mjs --manifest` fails when the two lists differ. Write them from the
inventory: questions the data answers, a state change, an operation that ends in
confirmation, and one request the site cannot do, to show the agent declining honestly.
Never list features the site does not have. A query for a partner site asks only what
the partner can answer from here, such as "Is there a good place to eat nearby?", not
free tables or prices ("Site tools" in `linking.md`). The generated pizza network in the
agentic-web repository (`examples/pizza_restaurant_website_assistant.hocon`) asks to
"apply code FAMILY20" and about "order #48219", which are examples of this mistake.

Make each query work on its own, as the first message in a new chat, because anyone may
try any one first. Do not refer back to another query, as "Book that" does. If a query
needs a record the visitor already holds, such as a booking code, name a demo record the
site documents, such as a test code in its README. If answers depend on today's date,
give dates relative to today, such as "in three weeks", and check those dates against
the site's data.

## Worked example: the pizza site

The inventory above gives four operations and no separate knowledge or systems, so the
network is a single agent, `little_oven_assistant`, with four actions:

| Action | Effect | Behavior |
| --- | --- | --- |
| `get_restaurant_state` | read | Menu, page facts (size, fees, kitchen note), cart with `version`, latest order |
| `add_to_cart` | write | Adds a quantity of one menu item; keeps the rest of the cart |
| `set_cart_quantities` | write | Sets exact quantities for listed items; 0 removes; checks every line before changing any |
| `place_demo_order` | irreversible | Places the demo order for the current cart with name, pickup or delivery, address and time; refuses a stale `expectedVersion` |

The agent handles menu questions, cart changes, checkout and the latest order's status.
With one agent, a turn such as "add two Margherita pizzas" takes two model calls: the
tool call, then the answer.
