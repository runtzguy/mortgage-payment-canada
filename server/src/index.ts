import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const isProduction = process.env.NODE_ENV === "production";

// server/dist/index.js -> ../../client/dist ; server/src/index.ts (dev) never serves static.
const clientDistPath = path.resolve(__dirname, "../../client/dist");

const app = createApp({
  serveStatic: isProduction,
  clientDistPath,
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  // eslint-disable-next-line no-console
  console.error(
    err.code === "EADDRINUSE"
      ? `Port ${PORT} is already in use.`
      : `Server failed to start: ${err.message}`,
  );
  process.exit(1);
});

// Stop accepting connections and let in-flight requests finish before exiting,
// so a rolling deploy doesn't drop a response mid-calculation.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
