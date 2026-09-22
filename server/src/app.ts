import express, { type Express } from "express";
import path from "node:path";
import { mortgageRouter } from "./routes/mortgage.js";
import { errorHandler } from "./middleware/errorHandler.js";

export interface CreateAppOptions {
  /** Serve the built client from `clientDistPath` and fall back to its index.html for SPA routes. */
  serveStatic?: boolean;
  clientDistPath?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/mortgage", mortgageRouter);

  if (options.serveStatic && options.clientDistPath) {
    const clientDistPath = options.clientDistPath;
    app.use(express.static(clientDistPath));
    // SPA fallback: any unmatched GET that isn't an API call gets index.html
    // so client-side routing works on a hard refresh / deep link.
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(clientDistPath, "index.html"));
    });
  }

  // Must be registered last: Express recognizes error middleware by arity.
  app.use(errorHandler);
  return app;
}
