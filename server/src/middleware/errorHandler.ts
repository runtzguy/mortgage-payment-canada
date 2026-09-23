import type { ErrorRequestHandler } from "express";
import { ApiError } from "../errors.js";

/** A body-parser failure: the client sent a body Express could not parse. */
function isBodyParseError(err: unknown): err is { status: number; type: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type?: unknown }).type === "entity.parse.failed"
  );
}

/** Maps typed ApiErrors to their HTTP response; anything else is an unexpected 500. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.field ? { field: err.field } : {}),
      },
    });
    return;
  }

  // Malformed JSON is the client's mistake, not ours: answer 400 in the same
  // error shape rather than reporting (and logging) it as a server fault.
  if (isBodyParseError(err)) {
    res.status(400).json({
      error: { code: "INVALID_INPUT", message: "Request body is not valid JSON." },
    });
    return;
  }

  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  });
};
