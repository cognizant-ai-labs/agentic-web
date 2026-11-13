// Registers this test site's one action with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.

/**
 * Describes the test site's read action.
 *
 * The site has no page script, so the action returns fixed data: what the desk helps with
 * and the page of each partner site.
 */
class SiteActions {
  /**
   * What the read action returns.
   */
  static STATE = {
    site: "Marrow Point Visitor Desk",
    helpsWith: "Planning a stay in Marrow Point.",
    partners: [
      {
        name: "Tidewhistle Guesthouse",
        page: "http://127.0.0.1:8080/",
      },
    ],
  };

  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.readStateAction());
  }

  /**
   * Describe the read action.
   *
   * :return: The action definition.
   */
  static readStateAction() {
    return {
      name: "get_desk_state",
      description: "Read what Marrow Point Visitor Desk helps with and the page of each partner site.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.readState,
    };
  }

  /**
   * Return a fresh copy of the desk's data.
   *
   * :return: The data as plain JSON.
   */
  static readState() {
    return structuredClone(SiteActions.STATE);
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
