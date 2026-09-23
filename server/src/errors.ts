import type { MortgageErrorCode } from "@benjipays/shared";

/**
 * Typed error the route/service layers throw for known failure cases.
 * `errorHandler` middleware maps these to their HTTP response.
 */
export class ApiError extends Error {
  readonly code: MortgageErrorCode;
  readonly statusCode: number;
  readonly field?: string;

  constructor(
    code: MortgageErrorCode,
    message: string,
    options: { field?: string; statusCode?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = options.statusCode ?? 400;
    this.field = options.field;
  }
}

export class DownPaymentTooLowError extends ApiError {
  constructor(propertyPrice: number, minimumDownPayment: number) {
    const price = propertyPrice.toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    });
    const minimum = minimumDownPayment.toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 2,
    });
    super(
      "DOWN_PAYMENT_TOO_LOW",
      `Down payment is not enough. Minimum required for a ${price} property is ${minimum}.`,
      { field: "downPayment" },
    );
    this.name = "DownPaymentTooLowError";
  }
}

export class InvalidInputError extends ApiError {
  constructor(message: string, field?: string) {
    super("INVALID_INPUT", message, { field });
    this.name = "InvalidInputError";
  }
}

/** An unmatched route under /api, so the client still gets the JSON error shape. */
export class NotFoundError extends ApiError {
  constructor(method: string, path: string) {
    super("NOT_FOUND", `Cannot ${method} ${path}.`, { statusCode: 404 });
    this.name = "NotFoundError";
  }
}
