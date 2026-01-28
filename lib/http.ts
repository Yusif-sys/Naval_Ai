import http from "http";
import https from "https";
import { URL } from "url";
import zlib from "zlib";

type RequestOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
};

function unzipIfNeeded(buf: Buffer, encoding: string | undefined): Buffer {
  const enc = (encoding ?? "").toLowerCase();
  if (enc.includes("gzip")) return zlib.gunzipSync(buf);
  if (enc.includes("deflate")) return zlib.inflateSync(buf);
  // If br shows up, fall back to raw (most nav.al responses are gzip/plain)
  return buf;
}

export async function fetchText(url: string, opts: RequestOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxRedirects = opts.maxRedirects ?? 5;

  async function inner(currentUrl: string, redirectsLeft: number): Promise<string> {
    const u = new URL(currentUrl);
    const lib = u.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.request(
        u,
        {
          method: "GET",
          headers: {
            "User-Agent": "NavalArchiveChatBot/1.0 (+https://nav.al/archive)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Encoding": "gzip,deflate",
            ...(opts.headers ?? {})
          }
        },
        res => {
          const status = res.statusCode ?? 0;

          if ([301, 302, 303, 307, 308].includes(status)) {
            const loc = res.headers.location;
            if (!loc) {
              reject(new Error(`Redirect without Location for ${currentUrl}`));
              return;
            }
            if (redirectsLeft <= 0) {
              reject(new Error(`Too many redirects for ${currentUrl}`));
              return;
            }
            const next = new URL(loc, u).toString();
            res.resume(); // drain
            void inner(next, redirectsLeft - 1).then(resolve, reject);
            return;
          }

          if (status < 200 || status >= 300) {
            const chunks: Buffer[] = [];
            res.on("data", d => chunks.push(Buffer.from(d)));
            res.on("end", () => {
              const body = Buffer.concat(chunks).toString("utf8");
              reject(new Error(`Failed to fetch ${currentUrl}: ${status} ${body.slice(0, 200)}`));
            });
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", d => chunks.push(Buffer.from(d)));
          res.on("end", () => {
            try {
              const raw = Buffer.concat(chunks);
              const unzipped = unzipIfNeeded(raw, String(res.headers["content-encoding"] ?? ""));
              resolve(unzipped.toString("utf8"));
            } catch (e) {
              reject(e);
            }
          });
        }
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout after ${timeoutMs}ms for ${currentUrl}`));
      });
      req.on("error", reject);
      req.end();
    });
  }

  return inner(url, maxRedirects);
}

