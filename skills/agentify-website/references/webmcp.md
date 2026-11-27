# WebMCP (optional)

WebMCP is a draft browser API from the W3C Web Machine Learning Community Group. A page
registers functions with `modelContext.registerTool()`, and an agent in the browser can
call them: an agent built into the browser, or a browser extension that acts for the
visitor. The site's actions already have WebMCP's shape (name, description, input schema,
code), so registering them lets the visitor's own agent use the site's functions instead
of clicking through the page.

Only Chromium browsers have it, as origin trials, and no browser turns it on by default.
Firefox has no position yet, and WebKit opposes it. So this step is off by default, and the
site must work as before where `modelContext` is missing. Ask the site owner before you add
it.

## What it does

`templates/webmcp.js` registers the actions `site-actions.js` gives the site's assistant,
with the same names, descriptions, schemas and code. The runtime's rules carry over:

| Effect | WebMCP | Runs |
| --- | --- | --- |
| `read` | `readOnlyHint: true` | at once |
| `write` | no hint | at once, as for the site's assistant |
| `irreversible` | `consequentialHint: true` | only after the visitor confirms in the page's own dialog |

WebMCP leaves confirmation to the calling agent, which the site cannot trust, so an
irreversible action asks on the page itself. Without a confirm function, irreversible
actions are not offered. Arguments are checked against each action's `inputSchema` with the
runtime's validator before `execute` runs. A refusal (`ok: false`) or a validation error is
returned as a tool error, and a throw after `execute` started is reported as an unknown
outcome, as the runtime does. Actions with `availability: "bridge"` are left out: they
belong to partner sites.

The draft spec and Chromium 153 name the object `document.modelContext`; earlier trial
notes used `navigator.modelContext`. The template uses whichever exists, and `provideContext()` when
`registerTool()` is missing.

## Add it

1. Copy `templates/webmcp.js` to `<out>/webmcp.js`.
2. In `site.js`, after the runtime boots, register the actions with the page's dialog:
   ```js
   import { SiteWebMCP } from "./webmcp.js";
   // in start(), after AssistantMount.engine is set:
   SiteWebMCP.register({ confirm: AssistantMount.review });
   ```
   To offer reads and writes even when the assistant fails to boot, also call
   `SiteWebMCP.register()` in the `catch` branch, with no confirm function.
3. For Chrome's origin trial, register the site's origin and add the token the trial page
   gives you to `index.html`:
   ```html
   <meta http-equiv="origin-trial" content="<token>">
   ```
   Edge has its own trial and token. For local checks, turn on
   `chrome://flags/#enable-webmcp-testing` instead.
4. Mention it in the README: which actions a browser agent gets, and that irreversible ones
   ask on the page.

## Check it

The tests in `tests/skills/agentify-website/webmcp/` use a stand-in `modelContext`. To check
the real API, start Chromium 153 or newer with `--enable-features=WebMCPTesting` (or turn on
`chrome://flags/#enable-webmcp-testing`), open the site, and run in the console:

```js
const tools = await document.modelContext.getTools();
tools.map((t) => t.name);
const add = tools.find((t) => t.name === "add_to_cart");
await document.modelContext.executeTool(add, JSON.stringify({ id: "margherita", quantity: 1 }));
```

`executeTool` takes the registered tool and its arguments as a JSON string. A read or write
returns its result at once; an irreversible action opens the site's dialog first, and
returns "Nothing ran" when the visitor declines. In Chromium 153, `getTools()` keeps
`readOnlyHint` but drops `consequentialHint`, so the page's own dialog is what protects an
irreversible action.
