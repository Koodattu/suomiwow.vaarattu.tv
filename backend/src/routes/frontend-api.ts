import { Router } from "express";
import { request } from "node:http";

// Keep the public frontend image APIs on the same measured request path as the
// backend APIs. The upstream is fixed; request parameters cannot select a host.
export function frontendApiRouter(upstream = process.env.NODE_ENV === "production" ? "http://frontend:3000" : "http://localhost:3000") {
  const router = Router();
  for (const path of ["/ccg/render", "/og", "/og/ccg", "/og/ccg/share/:kind/:shareId"]) {
    router.get(path, (req, res) => {
      const headers: Record<string, string> = {};
      for (const name of ["accept", "if-none-match", "if-modified-since"]) {
        const value = req.get(name);
        if (value) headers[name] = value;
      }
      const proxy = request(new URL(req.originalUrl, upstream), { method: req.method, headers, timeout: 30000 }, (response) => {
        res.status(response.statusCode || 502);
        for (const name of ["content-type", "content-length", "cache-control", "etag", "last-modified", "vary", "content-disposition"]) {
          const value = response.headers[name];
          if (value !== undefined) res.setHeader(name, value);
        }
        response.on("error", () => res.destroy());
        response.pipe(res);
      });
      proxy.on("timeout", () => proxy.destroy(new Error("Frontend API timeout")));
      proxy.on("error", () => { if (!res.headersSent) res.sendStatus(502); else res.destroy(); });
      res.on("close", () => proxy.destroy());
      proxy.end();
    });
  }
  return router;
}
