import type {
  ApiErrorBody,
  MortgageErrorCode,
  MortgagePaymentResponse,
  MortgageRequest,
} from "@benjipays/shared";

/** Thrown when the server responds with a known, typed error (4xx). */
export class MortgageApiError extends Error {
  readonly code: MortgageErrorCode;
  readonly field?: string;

  constructor(body: ApiErrorBody) {
    super(body.error.message);
    this.name = "MortgageApiError";
    this.code = body.error.code;
    this.field = body.error.field;
  }
}

/**
 * The only function in the client that calls fetch. Components go through
 * this (or a hook wrapping it), never fetch() directly.
 */
export async function fetchMortgagePayment(
  payload: MortgageRequest,
): Promise<MortgagePaymentResponse> {
  const response = await fetch("/api/mortgage/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (data && typeof data === "object" && "error" in data) {
      throw new MortgageApiError(data as ApiErrorBody);
    }
    throw new Error(`Request failed with status ${response.status}.`);
  }

  return data as MortgagePaymentResponse;
}
