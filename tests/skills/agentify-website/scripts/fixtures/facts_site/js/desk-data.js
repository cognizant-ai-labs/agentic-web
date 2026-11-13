/**
 * The desk's opening hours: test data for scripts/facts_network.test.mjs.
 */
export class DeskData {
  /**
   * Each day the desk opens, with its hours.
   */
  static HOURS = [
    {
      days: "Monday to Friday",
      open: "9 am",
      close: "5 pm",
    },
    {
      days: "Saturday and Sunday",
      open: "10 am",
      close: "4 pm",
    },
  ];
}
