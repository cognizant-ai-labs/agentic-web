import { BookingPage } from "./booking-page.js";
import { ReservationBook } from "./reservation-book.js";

/**
 * Starts the booking page. index.html loads this module.
 */
export class App {
  /**
   * Create the reservation book and connect it to the page.
   *
   * :param doc: the page's document
   * :return: the running booking page
   */
  static start(doc) {
    const page = new BookingPage(doc, new ReservationBook());
    page.start();
    return page;
  }
}

App.start(document);
