// Media Sync notifications: thin level-based wrapper over the shared kit
// Notifier so titles, auth, header sanitizing and click-through stay uniform.

import { Notifier as KitNotifier } from "@dscpln/server-kit";

const LEVELS = {
  error: { priority: "high", tags: ["warning"] },
  warn: { priority: "default", tags: ["warning"] },
  info: { priority: "low", tags: ["white_check_mark"] },
};

export class Notifier {
  constructor(config, log) {
    this.log = log;
    this.inner = new KitNotifier({}, (line) => log.log(line));
    this.setConfig(config);
  }

  setConfig(config) {
    this.notifySuccess = config.ntfy?.notifySuccess ?? true;
    const origin = String(process.env.DSCPLN_ORIGIN ?? "").trim().replace(/\/+$/, "");
    this.inner.setConfig({
      ntfy: { ...(config.ntfy ?? {}), notifySuccess: true },
      click: /^https?:\/\//i.test(origin) ? `${origin}/media` : "",
    });
  }

  async notify(level, message) {
    if (level === "info" && !this.notifySuccess) return { ok: true, skipped: true };
    const { priority, tags } = LEVELS[level] ?? LEVELS.info;
    const result = await this.inner.notify(message, {
      title: "D$CPLN · Media Sync",
      priority,
      tags,
    });
    if (!result.ok && this.inner.configured) this.log.log(`ntfy notification failed: ${result.error}`);
    return result;
  }
}
