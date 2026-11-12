import { ToursPage } from "./tours-page.js";
import { TripBasket } from "./trip-basket.js";
import { TripBook } from "./trip-book.js";

/**
 * Starts the tours page. index.html loads this module.
 */
export class App {
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

App.start(document);
