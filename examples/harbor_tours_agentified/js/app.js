import { ToursPage } from "./tours-page.js";
import { TripBasket } from "./trip-basket.js";
import { TripBook } from "./trip-book.js";

/**
 * Starts the tours page. index.html loads this module.
 *
 * It keeps the one running page in App.page. The assistant's actions
 * (site-actions.js) and its confirmation dialog (site.js) import this module
 * by the same URL and use that page, so they share its state.
 */
export class App {
  /** The running tours page, or null before the module has started it. */
  static page = null;

  /**
   * Create the trip book and the basket, and connect them to the page.
   *
   * :param doc: the page's document
   * :return: the running tours page
   */
  static start(doc) {
    const book = new TripBook();
    const page = new ToursPage(doc, book, new TripBasket(book));
    page.start();
    return page;
  }
}

App.page = App.start(document);
