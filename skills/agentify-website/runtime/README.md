# Browser runtime

This folder runs the agent network in the visitor's browser. Copy it into each
agentified site unchanged.

It is the [nsdeploy](https://github.com/cognizant-ai-lab/nsdeploy) browser runtime
(Apache 2.0, see `LICENSE.txt`) with edits that let agents call a site's own functions.
nsdeploy's runtime cannot do that yet. The same copy is in the agentic-web repository at
`examples/pizza_restaurant_agentified/runtime/`.

Edited files:

- `runner.js` offers each action listed in the manifest's `actions.agentTools` as a
  `website_<name>` tool and runs it through the site's action registry. Actions with the
  `irreversible` effect ask the visitor first. It also adds a `render_cruse` tool for
  forms and tables in the chat.
- `engine.js` passes the page's confirmation dialog to `runner.js`.
- `cruse.js` accepts CRUSE replies without code fences and merges forms from several
  agents into one.

Protocol name: `nsdeploy`. Use it for `<protocol_name>` in `agent-manifest.json`. It
names the discovery files, such as `.well-known/nsdeploy.json`, that nsdeploy's tools read.

Do not edit these files for one site. When nsdeploy's own runtime offers these tools,
use it instead of this copy.
