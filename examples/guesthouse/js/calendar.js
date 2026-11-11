/**
 * Date helpers for stays. Dates are "YYYY-MM-DD" strings, and day math runs in
 * UTC so daylight saving changes never add or drop a day.
 *
 * today() is the only place the site reads the clock. Tests can pin the date
 * by setting Calendar.fixedToday to a "YYYY-MM-DD" string.
 */
export class Calendar {
  /** A "YYYY-MM-DD" date to use instead of the real clock, or null. */
  static fixedToday = null;

  /**
   * Return today's date in the visitor's time zone, or the pinned date.
   *
   * :return: today as "YYYY-MM-DD"
   */
  static today() {
    if (Calendar.fixedToday) return Calendar.fixedToday;
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
  }

  /**
   * Check that a value is a real date written as "YYYY-MM-DD".
   *
   * :param value: the value to check
   * :return: true when the value is a valid date
   */
  static isDate(value) {
    // The round trip rejects dates that do not exist, such as "2026-02-30".
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && Calendar.addDays(value, 0) === value;
  }

  /**
   * Turn a "YYYY-MM-DD" string into a Date at midnight UTC.
   *
   * :param iso: the date
   * :return: the matching Date
   */
  static toDate(iso) {
    const parts = iso.split("-");
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  }

  /**
   * Add whole days to a date.
   *
   * :param iso: the starting date
   * :param days: the number of days to add, which may be negative
   * :return: the new date as "YYYY-MM-DD"
   */
  static addDays(iso, days) {
    const date = Calendar.toDate(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  /**
   * Count the days from one date to another.
   *
   * :param from: the first date
   * :param to: the second date
   * :return: the number of days, negative when to comes before from
   */
  static daysBetween(from, to) {
    return Math.round((Calendar.toDate(to) - Calendar.toDate(from)) / 86400000);
  }

  /**
   * Format a date for people to read, such as "Fri, Nov 13, 2026".
   *
   * :param iso: the date
   * :return: the formatted date
   */
  static format(iso) {
    return Calendar.toDate(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
}
