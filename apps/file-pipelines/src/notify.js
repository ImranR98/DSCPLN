// File Pipelines notifications: thin level-based wrapper over the shared kit
// Notifier. Delivery goes through the portal relay (DSCPLN_PORTAL_URL); the
// portal owns the ntfy URL + token and titles/auth/header sanitizing stay
// uniform across apps.

import { clickFor, Notifier as KitNotifier } from "@dscpln/server-kit";

const LEVELS = {
  error: { priority: "high", tags: ["warning"] },
  warn: { priority: "default", tags: ["warning"] },
  info: { priority: "low", tags: ["white_check_mark"] },
};

export class Notifier {
  constructor(config, log) {
    this.log = log;
    this.inner = new KitNotifier({ app: "File Pipelines" }, (line) => log.log(line));
    this.setConfig(config);
  }

  setConfig(config) {
    this.notifySuccess = config.notifySuccess !== false;
    this.inner.setConfig({
      app: "File Pipelines",
      relayUrl: process.env.DSCPLN_PORTAL_URL ?? "",
      click: clickFor(process.env.BASE_PATH ?? ""),
    });
  }

  async notify(level, message) {
    if (level === "info" && !this.notifySuccess) return { ok: true, skipped: true };
    const { priority, tags } = LEVELS[level] ?? LEVELS.info;
    const result = await this.inner.notify(message, {
      title: "D$CPLN - File Pipelines",
      priority,
      tags,
    });
    if (!result.ok && this.inner.configured) this.log.log(`notification failed: ${result.error}`);
    return result;
  }
}
