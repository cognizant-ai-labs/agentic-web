---
name: agentify-website
description: Turn an existing website into an open agentic website. Inventory the site's data and operations, design a small grounded Neuro SAN agent network, expose the site's own functions as website_* tools, embed the browser runtime with a BYOK chat, let other agent websites call the network and, when asked, let it call theirs, and verify it with Node tests. Use when asked to agentify a website, add an assistant or chat agent to a site, create an agent network from a website, or link an agentic website with other agent websites, given a local site folder or a public URL.
---

# Agentify a website

This skill turns a website into an open agentic website, as defined in the
[Worldwide Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md).
The result is a copy of the site with an assistant embedded in the page. The assistant
runs in the visitor's browser, uses the visitor's own LLM key, answers from the site's
real data, and calls the site's own functions to act.

## What you need

- **The site.** A local folder with its HTML, CSS and JavaScript (source mode), or a
  public URL (live URL mode, see `references/live_url_mode.md`).
- **Node.js 22 or newer**, for the build script and the tests.
- **A POSIX shell** for the `cp`, `rm` and `curl` commands: Terminal on macOS, a Linux
  shell, or Git Bash or WSL on Windows.
- **Nothing else to serve the site:** `scripts/serve_site.mjs` runs on Node.

The browser runtime is in this skill's `runtime/` folder. It is nsdeploy's runtime with
edits that let agents call the site's functions and run a partner site's network on this
site's model and step limit. nsdeploy's own runtime does neither yet. Do not install or
run nsdeploy, and do not replace this copy.

In the commands below, `SKILL_DIR` is the folder that contains this file.

## Workflow

### 1. Inventory the site

Read every page and script. Fill in the inventory table from
`references/network_design.md`: data, state, operations (with whether the visitor can undo
them), what the site does not support, and external services. Note the file and line
for each item.

If a partner named on the site publishes its own agent network (its site has an
`agent-manifest.json`) and the user wants the assistant to ask it, note its network URL
and check it before the checkpoint (step 1 of "Call a partner site" in
`references/linking.md`).

For a public URL without source, follow `references/live_url_mode.md` first.

**Checkpoint.** Show the user the inventory and the proposed design (agents, tools,
the effect of each action, the "not supported" list, and each partner site it will ask,
with what it asks and what it can answer from here) and ask them to confirm. Pay
attention to which actions are `irreversible`, since `read` and `write` tools run without
a dialog. Skip the checkpoint only if the user said to proceed without asking.

### 2. Design the network

Follow `references/network_design.md`. The defaults are:

- one front agent that owns all `website_*` tools; add a specialist only for separate
  knowledge, a separate system, or a separate workflow;
- plain delegation with a `request` parameter, not AAOSA;
- no `demo_mode`; facts only from tool results; a list of what the site cannot do;
- shared rules in `commondefs.replacement_strings`, with CRUSE rules on the front agent only;
- sample queries the site can really answer, plus one it must decline;
- other agent websites can run every site's network: keep the template's `{peer_rules}`
  (`references/linking.md`);
- a partner site with an agent network is a tool named by its full network URL, never a
  link slot.

### 3. Copy the site and the runtime

```shell
cp -R <site> <out>
cp -R SKILL_DIR/runtime <out>/runtime
```

Pick `<out>` with the user. The default is a sibling folder named `<site>_agentified`.
If `<out>` already exists, ask the user whether to delete it or pick another folder.
Do not copy into it: `cp -R` puts the new copy inside it and keeps the old files.
Never change the original site or the runtime files. If the site already has `site.js`,
`site-actions.js`, `agent-manifest.json`, `agent-mcp.json`, `links.json`, a `.well-known/`
discovery file, `bridge/`, `runtime/` or `tests/`, ask the user first: the skill writes
files with those names. If the copy has a README, update it before you finish, as "The
README" in `references/bundle_and_hosting.md` says.

### 4. Expose the site's operations

Follow `references/site_actions.md`:

1. Make the page script a module that exports its page object, such as a static
   `App.page`, with a state reader and one method per operation. Make the page's own
   buttons and forms call those same methods. An operation refuses bad input by returning
   `{ok: false, reason}` without changing anything; a thrown error is reported to the
   agent as "unknown outcome".
2. Give each irreversible operation one read-only check that it calls first. Add a
   version counter if it acts on page state that is not in its arguments, such as a
   cart. If an amount the visitor agrees to can change by itself, such as a fee that
   depends on today's date, also pass the amount they saw and refuse a mismatch, unless
   the site already does.
3. Write `<out>/site-actions.js` from `templates/site-actions.js`.

### 5. Write the network and the manifest

Copy `templates/network.hocon` to `<out>/<network>.hocon`, and
`templates/agent-manifest.json` and `templates/links.json` to `<out>/`. The build writes
the `bridge/` folder that other agent sites load; do not edit it. If the site calls
partner sites, follow "Call a partner site" in `references/linking.md`; otherwise delete
the template's partner parts. Replace every `<...>` and `TODO`. The network name is the
`.hocon` file name and must be the same everywhere. Use the protocol name in
`runtime/README.md` for `<protocol_name>`. Then build:

```shell
node SKILL_DIR/scripts/build_network.mjs <out>/<network>.hocon --manifest <out>/agent-manifest.json
```

This writes `<out>/<network>.network.json` with the runtime's own parser, runs the
runtime's validator, and checks for leftover `<...>` and `TODO` markers, demo mode, AAOSA,
agents nothing can call, agents with no model, oversized instructions, unsupported tools,
unused or unlisted `website_*` tools, manifest mismatches, a missing or misplaced action
bridge, partner URLs the runtime would refuse, and partners with no consent-card label.
It also writes the discovery files, which copy parts of the manifest: `agent-mcp.json`,
`.well-known/<protocol_name>.json` and `.well-known/<protocol_name>-agent.json`. It prints
the tools the runtime adds to every agent, which the `tools` lists do not show. Fix every
error. Fix the warnings too, or tell the user why one stays. Never edit generated files by
hand: change the `.hocon` or the manifest and rebuild.

### 6. Mount the assistant

Follow `references/bundle_and_hosting.md`:

1. Add `templates/assistant-section.html` to the page, with its heading and sentence
   filled in, and `templates/assistant.css` to its stylesheet. Set the `--ns-*` colors
   and `theme.primary` to the site's palette. White text sits on `--ns-primary` and
   `--ns-accent`, so keep both dark enough.
2. Copy `templates/site.js` to `<out>/site.js` and load it with `<script type="module">`.
   Write a `GREETING`, and fill in `DIALOGS` for each `irreversible` action. For a
   partner, promise only what it can answer from here (step 5 of "Call a partner site" in
   `references/linking.md`). Name the buttons after what they do, such as "Keep the
   booking", not "Cancel". Give `reviewDetails` the real details, such as items, total,
   name and email, and any fee it brings now or later, such as a cancellation fee. The
   dialog opens before the operation runs, so `reviewDetails` also calls the operation's
   read-only check. When it refuses, return `{refusal: reason}`: no dialog opens, and the
   agent gets the site's reason. Only this site's own actions get this dialog: a partner
   site's action with the same name gets the runtime's dialog, and a chat form that
   bundles one of them with other actions runs nothing.
3. The page must still work when the assistant fails to boot.
4. If the page says that nothing is sent or that no data leaves it, change that line: the
   assistant sends the visitor's messages, and the page data it reads, to their LLM
   provider.

### 7. Test

Copy `templates/tests/` to `<out>/tests/`, fill in the TODOs, and add the tests in "Test
every action" in `references/site_actions.md`. Then run:

```shell
node SKILL_DIR/scripts/build_network.mjs <out>/<network>.hocon --manifest <out>/agent-manifest.json --check
node --test "<out>/tests/*.test.mjs"
```

Quote the glob. Node 22 does not accept a bare folder after `--test`.

Then serve the site with `node SKILL_DIR/scripts/serve_site.mjs <out> --port 8080`. If a
partner already runs on this machine, use the other port and host name from "Two linked
sites" in `references/linking.md` instead: on one host name, the key cookie reaches the
partner. Unlike `python3 -m http.server`, the server sends the CORS header on the public
files, so other sites can call this one. For each partner, run
`node SKILL_DIR/scripts/check_partner.mjs <partner network URL> --origin <this site's origin>`,
and run it on this site's own network URL with no `--origin` ("Callers" in "Check it" in
`references/linking.md`). To check a chat form, a choice list, the confirmation dialog
and the consent card without a key, use the console check in "Check without a key" in
`references/bundle_and_hosting.md`.

If the user wants a live check, ask them to enter their own key in **⚙ AI model settings** and try
each sample query. If the site calls a partner, check that the consent card names it,
that nothing reaches the partner before the visitor answers (the browser's Network panel,
or the `--log` file of a partner served on this machine), and that declining gives an
honest answer. Never ask the user to paste a key into the chat. On `localhost` and
`127.0.0.1`, the runtime also saves keys in a cookie that any local site can read, so
suggest a key with a low spending limit. Afterwards, they should delete the saved setup
and close the tab: the tab keeps using the key until it is closed (see "Serving and
trying it" in `references/bundle_and_hosting.md`).

### 8. Report

Tell the user:

- where the output is and how to run it;
- where the site can be listed once it is hosted (see "How others find the site" in
  `references/bundle_and_hosting.md`);
- the headers to set when it is hosted, with the real file names (see "Static hosting"
  in `references/bundle_and_hosting.md`);
- the network (agents and their tools) and the actions (name, effect, wrapped function);
- the network URL (the folder that holds `agent-manifest.json`, then the network name);
  what other agent sites get when they call it (no site tools; the assistant points to
  this site's page; their visitor also gets a card for each partner this site calls);
  and each partner it calls, with what its requests contain and what the partner's
  network can reach, from `check_partner.mjs`;
- each partner URL on `localhost` or `127.0.0.1`, which works only for local checks, and
  what to replace before hosting: the partner tool, its `link_labels` key, its
  `allowed_peers` origin and, if the tool name changes, the "How to work" line;
- what the assistant can answer and do, and what it declines;
- the exact test commands and their results;
- the limits:
  - static hosting only, with a patched copy of nsdeploy's runtime;
  - `write` actions run without showing the visitor first, which the spec does not
    allow, so a model that follows text in a partner's answer could change the page's
    state without asking;
  - every agent can see every `website_*` tool;
  - callers get no `website_*` tools, so live availability and bookings stay on the
    site's own page;
  - each partner call runs on the visitor's key after the visitor agrees, at most 4 per
    message and 1 per partner, and costs more than the card's token estimate;
  - a call over a limit still shows its card first, and allowing it only skips the call;
  - a partner that accepts the connection but never answers leaves the chat waiting,
    with no way to stop it except reloading the page;
  - the consent card shows only the first 140 characters of a request, and the partner
    gets all of it;
  - the consent card shows the partner's host without its scheme, and "Always allow"
    covers that host until the page is reloaded;
  - under a subpath or another host name, a partner that names this site may show the
    visitor a card for this site; under a subpath, allowing it only skips the call, and
    under another host name it runs this network once more;
  - the LLM provider must allow CORS;
  - the network file, including instructions, is public.

## Rules

- Never fabricate. No `demo_mode`, and no invented prices, times, IDs or statuses.
- Do not copy site data into instructions, and do not paste page state into prompts.
  Agents read state with a read action.
- When unsure whether an action can be undone, make it `irreversible`.
- Keep the site's business rules in the site's own functions. The actions module only
  wraps them.
- Do not edit `runtime/`, `bridge/`, `<network>.network.json` or the discovery files by
  hand.
- Do not put keys, tokens or personal data in any published file.
- Never put a visitor's name, email, phone number or booking code in a request to a
  partner site.
- Keep the original page usable without the assistant.

## Files in this skill

| Path | Use |
| --- | --- |
| `references/network_design.md` | Inventory, agent count, delegation, instructions, worked example |
| `references/site_actions.md` | Action registry, effects, receipts, what to test |
| `references/bundle_and_hosting.md` | Output layout, manifest, mounting, providers, hosting, discovery |
| `references/live_url_mode.md` | Companion assistant for a public URL without source |
| `references/linking.md` | Calls between agent sites: the bridge, the peer rule, partner sites, checks |
| `runtime/` | Browser runtime; copy into each site unchanged (see `runtime/README.md`) |
| `scripts/build_network.mjs` | HOCON → `.network.json`, with validation and checks |
| `scripts/serve_site.mjs` | Local server that sends the CORS header on the public files |
| `scripts/check_partner.mjs` | Checks a partner site's network and prints what it can reach |
| `templates/network.hocon` | Network skeleton with shared grounding and CRUSE rules |
| `templates/agent-manifest.json`, `links.json` | Public bundle files |
| `templates/site-actions.js` | Actions module for a site you can change |
| `templates/content-actions.js` | Actions module over a content snapshot (live URL mode) |
| `templates/site.js`, `assistant-section.html`, `assistant.css` | Mounting the assistant in the page |
| `templates/standalone-index.html` | Page for a companion assistant |
| `templates/bridge/action-bridge.html` | The build copies it into `<out>/bridge/`; other agent sites load it |
| `templates/tests/` | Node tests with a DOM stand-in and a scripted model |
