// Starts headless Chrome for the linking check, so that it can reach only local servers.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, existsSync, openSync } from "node:fs";

/**
 * Finds, starts and stops a headless Chrome with a DevTools port and its own profile.
 *
 * Every host but 127.0.0.1 and localhost fails to resolve, and other traffic goes to a
 * closed proxy port, so the browser cannot reach a real site, router or provider.
 */
export class ChromeLauncher {
  /**
   * Where Chrome or Chromium is usually installed, tried in order.
   */
  static KNOWN = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  /**
   * How long Chrome may take to open its DevTools port.
   */
  static START_TIMEOUT_MS = 20000;

  /**
   * Keep the settings. Call start() to launch.
   *
   * :param binary: The Chrome executable.
   * :param port: The DevTools port.
   * :param profile: An empty folder for the browser profile.
   * :param logFile: Where Chrome's own output goes.
   */
  constructor(binary, port, profile, logFile) {
    this.binary = binary;
    this.port = port;
    this.profile = profile;
    this.logFile = logFile;
    this.child = null;
    this.exited = null;
  }

  /**
   * Find the Chrome executable.
   *
   * :param explicit: The --chrome value, or null.
   * :return: The path, or null when none exists.
   */
  static locate(explicit) {
    if (explicit) {
      return existsSync(explicit) ? explicit : null;
    }
    if (process.env.CHROME) {
      return existsSync(process.env.CHROME) ? process.env.CHROME : null;
    }
    for (const candidate of ChromeLauncher.KNOWN) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * The command-line flags.
   *
   * :return: The flags, ending with the first page to open.
   */
  flags() {
    return [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--use-mock-keychain",
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profile}`,
      // Chrome sends loopback traffic directly and everything else to this closed port.
      "--proxy-server=http://127.0.0.1:9",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-default-apps",
      "--disable-extensions",
      "--no-pings",
      "--metrics-recording-only",
      "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication",
      "--window-size=1280,900",
      "about:blank",
    ];
  }

  /**
   * Launch Chrome and wait until its DevTools port answers.
   *
   * :raises Error: When Chrome exits early or the port does not answer in time.
   */
  async start() {
    const log = openSync(this.logFile, "a");
    this.child = spawn(this.binary, this.flags(), {
      stdio: [
        "ignore",
        log,
        log,
      ],
    });
    // The child keeps its own copy of the log file.
    closeSync(log);
    this.exited = once(this.child, "exit");
    const deadline = Date.now() + ChromeLauncher.START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        throw new Error(`Chrome exited with code ${this.child.exitCode}. See ${this.logFile}.`);
      }
      if (await ChromeLauncher.answers(this.port)) {
        return;
      }
      await ChromeLauncher.sleep(200);
    }
    throw new Error(`Chrome's DevTools port ${this.port} did not answer in ${ChromeLauncher.START_TIMEOUT_MS / 1000} seconds. See ${this.logFile}.`);
  }

  /**
   * Say whether the DevTools port answers.
   *
   * :param port: The port.
   * :return: True when it answers.
   */
  static async answers(port) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Stop Chrome and wait for it to exit. It is killed if it does not stop in 5 seconds.
   */
  async stop() {
    if (this.child === null || this.child.exitCode !== null || this.child.signalCode !== null) {
      return;
    }
    const timer = setTimeout(this.forceKill.bind(this), 5000);
    this.child.kill("SIGTERM");
    await this.exited;
    clearTimeout(timer);
  }

  /**
   * Kill Chrome at once.
   */
  forceKill() {
    if (this.child !== null && this.child.exitCode === null) {
      this.child.kill("SIGKILL");
    }
  }

  /**
   * Kill Chrome without waiting, for when the check itself is exiting.
   */
  killNow() {
    if (this.child !== null && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL");
    }
  }

  /**
   * Wait for a while.
   *
   * :param ms: Milliseconds.
   * :return: A promise that resolves after ms.
   */
  static sleep(ms) {
    return new Promise(ChromeLauncher.delay.bind(null, ms));
  }

  /**
   * Resolve after ms milliseconds.
   *
   * :param ms: Milliseconds.
   * :param resolve: The promise's resolve function.
   */
  static delay(ms, resolve) {
    setTimeout(resolve, ms);
  }
}
