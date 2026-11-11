import { BookingPage } from "./booking-page.js";
import { ReservationBook } from "./reservation-book.js";

/**
 * Starts the booking page. index.html loads this module.
 *
 * App.page is the running page. The assistant's actions and its confirmation
 * dialog use it too, so they share the page's bookings and forms.
 */
export class App {
  /** The running booking page, set when this module loads. */
  static page = null;

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

App.page = App.start(document);
