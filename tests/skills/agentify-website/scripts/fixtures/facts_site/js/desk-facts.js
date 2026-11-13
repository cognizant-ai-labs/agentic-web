import { DeskData } from "./desk-data.js";

/**
 * Words the desk's opening hours as its page does. It loads without a page.
 */
export class DeskFacts {
  /**
   * One line per opening period.
   *
   * :return: The lines.
   */
  static hours() {
    const lines = [];
    for (const period of DeskData.HOURS) {
      lines.push(`${period.days}: open ${period.open} to ${period.close}.`);
    }
    return lines;
  }
}
