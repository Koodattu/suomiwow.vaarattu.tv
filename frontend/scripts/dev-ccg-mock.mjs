// Runs `next dev` against the in-memory CCG mock API, so /ccg/open works without the backend or MongoDB.
// Usage: npm run dev:ccg-mock  ->  http://localhost:3100/ccg/open
//        npm run dev:ccg-mock:user  ->  same, signed in as a mock collector (enables sharing)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startCcgMockApi } from "./ccg-mock-api.mjs";

const apiPort = process.env.CCG_MOCK_PORT || "3101";
const webPort = process.env.CCG_MOCK_WEB_PORT || "3100";
const apiUrl = `http://localhost:${apiPort}`;
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

const server = startCcgMockApi();

const next = spawn(process.execPath, [nextBin, "dev", "--turbopack", "--port", webPort], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_API_URL: apiUrl, API_URL: apiUrl },
});

const shutdown = () => {
  next.kill();
  server.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
next.on("exit", (code) => {
  server.close();
  process.exit(code ?? 0);
});
