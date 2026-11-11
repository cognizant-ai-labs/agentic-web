# Site actions

Site actions connect the agent to what the page can do. The site owns them: the model
can only call an action that the site registered, with arguments that pass its schema.

This skill uses the edited runtime in its own `runtime/` folder.
Its `runner.js` turns each action listed in `agent-manifest.json` → `actions.agentTools`
into a model tool named `website_<name>`. Stock nsdeploy cannot do this; it only offers
actions as buttons or forms that the visitor clicks.

## Prepare the site code first

1. **Export shared functions.** The assistant must call the same functions as the
   page's own buttons and forms, so both follow one set of rules. Refactor the page
   script to export:
   - a state reader that returns plain JSON (catalog, current selection, a version
     number, the latest result), and copies rather than live objects;
   - one function per operation that validates its input, changes state, re-renders
     the page, and returns the new state or a receipt. Make the button handlers call it.
2. **Refuse by returning, not by throwing.** Check the whole input before changing
   anything. When the input is refused, return `{"ok": false, "reason": "...", "field": "..."}`
   and change nothing. The runtime reports any thrown error as outcome `unknown` ("may have
   happened, do not retry"), so throw only on unexpected failures. The page's own form
   handler can use `field` and `reason` with `setCustomValidity` to show the same message.
3. **Add a version counter** for state that an irreversible action depends on, such as a
   cart. Increment it on every change. The irreversible action takes `expectedVersion`
   and refuses a mismatch, so a visitor never confirms one cart and pays for another.
4. **Load the page script as a module** (`<script type="module">`) so it can export.
   Module scripts are deferred, like the `defer` scripts they usually replace.
5. **Import it by the same URL.** The actions module must import the page script by the
   URL the page loads it from, without a `?v=` cache-busting query. A different URL makes
   a second copy of the module with its own, separate state.
6. **Expose page-only facts through the read action.** Facts that exist only in the HTML
   (sizes, fees, opening hours, policies) must not be copied into instructions. Either
   read them from the page's own elements in the state reader (for example
   `document.querySelector("#delivery-note").textContent`, adding ids where needed), or
   move them into one object that both renders the HTML and feeds the state reader.

## Register actions

The module named in `actions.module` exports `registerActions(actions)` and calls
`actions.register(definition)` once per action. Start from `templates/site-actions.js`.

| Field | Rules (from `runtime/actions.js`) |
| --- | --- |
| `name` | Starts with a letter; letters, digits, `_` or `-`; up to 80 characters; unique. |
| `description` | What it does, what it returns, and what it does not do. The model reads this. |
| `inputSchema` | An object schema. Allowed keywords: `type`, `properties`, `required`, `additionalProperties` (only `false`), `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `format` (`date` or `email`), `title`, `description`, `default`, `x-*`. Anything else fails registration. Depth up to 8. |
| `effect` | `read`, `write` or `irreversible`. See below. |
| `availability` | Leave it out (`local-only`). Only local-only actions become `website_*` tools. |
| `timeoutMs` | Default 180000. A timeout is reported as outcome `unknown`. |
| `execute(args, context)` | Returns JSON data (up to 64 KB), or throws. Never return `undefined`. |

Schema tips:

- Use `enum` for IDs, built from the real catalog, so the model cannot invent items.
- Mark only truly required fields as `required`. Bound numbers and string lengths.
- Extra keys are always rejected, so the schema must list every argument.
- `pattern` is not supported. Check formats such as `HH:MM` in the site function and
  return a refusal; say the expected format in the field's `description`.

## Choose the effect carefully

In the patched runtime, `read` and `write` tools run **immediately, with no dialog**.
Only `irreversible` opens the confirmation dialog first. The spec asks the runtime to
show the visitor a write before it runs (section 3.1), so tell the user about this gap.

| Effect | Use for | Example |
| --- | --- | --- |
| `read` | Returns data, changes nothing. | get menu and cart |
| `write` | Changes page state the visitor can see and undo on the page. | add to cart, set quantities, fill a draft |
| `irreversible` | Anything the visitor cannot undo on the page: it places, sends, books, pays, deletes or contacts someone. | place order, submit request, send message |

When in doubt, choose `irreversible`. An irreversible tool is only offered when the
host provides a confirmation callback; `boot()` does this through `engine.onActionConfirm`.
`templates/site.js` wraps that callback to add readable details, such as items and total,
to the dialog.

## What the model sees

When the arguments pass the schema, the tool result is a receipt:

- `{"status": "succeeded", "result": ...}`: `execute` returned. `result` is what it
  returned: the updated state or receipt, or `{"ok": false, "reason": ...}` for a refusal.
- `{"status": "cancelled"}`: the visitor declined the dialog. Nothing ran.
- `{"status": "unknown", "error": ...}`: `execute` threw, timed out or returned bad data.
  The operation may have happened. The agent must not retry it.

When the arguments fail the schema, nothing runs and the model gets a plain string such
as `Error from tool 'website_add_item': Invalid arguments.id.` The template's
`{grounding_rules}` explain all of these cases to the agent.

Tool calls run one at a time, in order. Several calls in one model reply run in sequence.

## What not to expose

- Passwords, login, payment card fields, file uploads. Keep these in the site's own UI.
- Anything that needs a server the static site does not have. Say "not available"
  instead of faking it.
- Operations on another tab or window: actions run in the visitor's current page.

## Forms the runtime discovers by itself

The runtime can also discover native HTML forms (`actions.pages`, `actions.hostPage`) or
load a reviewed HTTP catalog (`actions.catalog`). Those actions get generated names or
`bridge`/`top-level` availability, so they **do not** become `website_*` tools. The agent
can only offer them as buttons or forms the visitor submits. Prefer explicit
`registerActions` entries that wrap the form's submit function, or that `fetch` its endpoint.

## Test every action

Copy `templates/tests/` into the output site and fill in the TODOs. At minimum, test:

- every `agentTools` name is registered and `local-only`;
- the read tool runs through `runAgent` with a scripted model and returns `succeeded`;
- each write changes state and the visible page, and rejects bad IDs without changing state;
- the irreversible tool is hidden without a confirmation callback, a decline from a
  state where it would succeed changes nothing, and an approved call gives the same
  result as the page's own form;
- a stale `expectedVersion` and each other refusal return `ok: false` and change nothing.

Run them with `node --test "<out>/tests/*.test.mjs"`. Node 22 does not accept a bare folder.

In the agentic-web repository, `examples/pizza_restaurant_agentified/tests/restaurant.test.mjs`
is a complete example.
