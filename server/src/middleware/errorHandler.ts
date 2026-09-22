import type { ErrorRequestHandler } from "express";
import { ApiError } from "../errors.js";

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

  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  });
};
