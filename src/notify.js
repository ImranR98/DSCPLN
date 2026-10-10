export class Notifier {
  constructor(config, log) {
    this.url = config.ntfy?.url?.trim() ?? "";
    this.token = config.ntfy?.token?.trim() ?? "";
    this.log = log;
  }

  setConfig(config) {
    this.url = config.ntfy?.url?.trim() ?? "";
    this.token = config.ntfy?.token?.trim() ?? "";
  }

  async notify(level, message) {
    if (!this.url) return { ok: false, error: "no ntfy URL configured" };
    const priority = level === "error" ? "high" : level === "warn" ? "default" : "low";
    // HTTP header values are Latin-1, so the stylized "↑" can only live in the body.
    const headers = { Title: "Media Sync", Priority: priority };
    if (this.token) headers.Authorization = `Basic ${Buffer.from(`:${this.token}`).toString("base64")}`;
    try {
      const res = await fetch(this.url, { method: "POST", headers, body: message });
      if (!res.ok) {
        this.log.log(`ntfy notification failed: HTTP ${res.status}`);
        return { ok: false, error: `ntfy responded with HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      this.log.log(`ntfy notification failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }
}
