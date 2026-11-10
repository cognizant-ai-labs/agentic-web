// Mounts the assistant inside the existing page. Load it with:
//   <script type="module" src="site.js"></script>
// The page needs the mount markup from assistant-section.html.
import { boot } from "./runtime/index.js";
// TODO: import a helper that turns current state into review details, or delete it.
import { reviewDetails } from "./script.js";

/**
 * Boots the browser runtime in the page's assistant section.
 *
 * It points the runtime at this folder, so the manifest, network and actions load from
 * the same place as the page. It also adds readable details to the confirmation dialog.
 */
class AssistantMount {
  /**
   * Boot the runtime and report the result in the status line.
   *
   * :return: The runtime engine, or null when boot failed.
   */
  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      status.textContent = "Assistant connected to this page.";
      return booted.engine;
    } catch (error) {
      // The page must keep working without the assistant.
      status.textContent = `Assistant unavailable: ${error.message}. You can still use the page directly.`;
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /**
   * Show the runtime's review dialog with extra, human-readable details.
   *
   * :param items: The actions waiting for confirmation, each with action and arguments.
   * :return: A promise that resolves true when the visitor confirms.
   */
  static review(items) {
    const enriched = [];
    for (const item of items) {
      // Show what will really happen (items, total), not only the raw arguments.
      if (item.action === "submit_order") {
        enriched.push({
          ...item,
          arguments: {
            ...item.arguments,
            ...reviewDetails(),
          },
        });
      } else {
        enriched.push(item);
      }
    }
    return AssistantMount.defaultReview(enriched);
  }
}

await AssistantMount.start();
