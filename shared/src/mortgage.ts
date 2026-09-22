import { z } from "zod";

/**
 * Contract shared between the client and server for the mortgage payment
 * calculation endpoint. Keeping this in one place means a change to the
 * allowed amortization periods, schedules, or request shape shows up as a
 * compile error on both sides instead of silently drifting.
 */

// ---------------------------------------------------------------------------
// Amortization periods
// ---------------------------------------------------------------------------

export const AMORTIZATION_YEARS_OPTIONS = [5, 10, 15, 20, 25, 30] as const;
export type AmortizationYears = (typeof AMORTIZATION_YEARS_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Payment schedules
// ---------------------------------------------------------------------------

export const PAYMENT_SCHEDULES = [
  "monthly",
  "biweekly",
  "accelerated-biweekly",
] as const;
export type PaymentSchedule = (typeof PAYMENT_SCHEDULES)[number];

export const PAYMENT_SCHEDULE_LABELS: Record<PaymentSchedule, string> = {
  monthly: "Monthly",
  biweekly: "Bi-weekly",
  "accelerated-biweekly": "Accelerated bi-weekly",
};

/** Number of payments per year for each schedule. */
export const PAYMENTS_PER_YEAR: Record<PaymentSchedule, number> = {
  monthly: 12,
  biweekly: 26,
  "accelerated-biweekly": 26,
};

// ---------------------------------------------------------------------------
// Minimum down payment (Canadian tiered rule)
// ---------------------------------------------------------------------------

export const MIN_DOWN_PAYMENT_TIER_1_MAX = 500_000;
export const MIN_DOWN_PAYMENT_TIER_2_MAX = 1_500_000;
export const MIN_DOWN_PAYMENT_TIER_1_RATE = 0.05;
export const MIN_DOWN_PAYMENT_TIER_2_RATE = 0.1;
export const MIN_DOWN_PAYMENT_TIER_3_RATE = 0.2;

// ---------------------------------------------------------------------------
// CMHC mortgage default insurance
// ---------------------------------------------------------------------------

/** A mortgage is insured when the down payment is under this fraction of the price. */
export const INSURED_DOWN_PAYMENT_THRESHOLD = 0.2;

/**
 * Standard CMHC premium rate by down payment percentage. Traditional down
 * payment sources with verified/documented income only; does not cover
 * non-traditional down payment sources or self-employed/non-verified income,
 * which CMHC prices on a different schedule.
 */
export const CMHC_PREMIUM_BRACKETS: ReadonlyArray<{
  /** Inclusive lower bound, as a fraction of price (0.05 = 5%). */
  minPercent: number;
  /** Exclusive upper bound, as a fraction of price. */
  maxPercent: number;
  rate: number;
}> = [
  { minPercent: 0.05, maxPercent: 0.1, rate: 0.04 },
  { minPercent: 0.1, maxPercent: 0.15, rate: 0.031 },
  { minPercent: 0.15, maxPercent: INSURED_DOWN_PAYMENT_THRESHOLD, rate: 0.028 },
];

/** Added to the premium rate when a 30-year amortization is used on an eligible insured mortgage. */
export const CMHC_THIRTY_YEAR_SURCHARGE = 0.002;

/** The only amortization that requires first-time-buyer / new-construction eligibility to insure. */
export const INSURED_THIRTY_YEAR_AMORTIZATION: AmortizationYears = 30;

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

export const MortgageRequestSchema = z
  .object({
    propertyPrice: z
      .number()
      .finite()
      .positive({ message: "propertyPrice must be greater than 0." }),
    downPayment: z
      .number()
      .finite()
      .nonnegative({ message: "downPayment cannot be negative." }),
    annualInterestRate: z
      .number()
      .finite()
      .min(0, { message: "annualInterestRate cannot be negative." })
      .max(100, { message: "annualInterestRate cannot exceed 100." }),
    amortizationYears: z.union(
      AMORTIZATION_YEARS_OPTIONS.map((year) => z.literal(year)) as [
        z.ZodLiteral<AmortizationYears>,
        z.ZodLiteral<AmortizationYears>,
        ...z.ZodLiteral<AmortizationYears>[],
      ],
      {
        errorMap: () => ({
          message: `amortizationYears must be one of: ${AMORTIZATION_YEARS_OPTIONS.join(", ")}.`,
        }),
      },
    ),
    paymentSchedule: z.enum(PAYMENT_SCHEDULES, {
      errorMap: () => ({
        message: `paymentSchedule must be one of: ${PAYMENT_SCHEDULES.join(", ")}.`,
      }),
    }),
    isFirstTimeHomeBuyer: z.boolean().optional().default(false),
    isNewConstruction: z.boolean().optional().default(false),
  })
  .refine((data) => data.downPayment < data.propertyPrice, {
    message: "downPayment must be less than propertyPrice.",
    path: ["downPayment"],
  });

export type MortgageRequest = z.infer<typeof MortgageRequestSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface MortgagePaymentResponse {
  /** Total per-payment amount: mortgagePayment + cmhcPayment (already reconciled to the cent). */
  payment: number;
  /** Portion of `payment` amortizing the principal (price - down payment) alone. */
  mortgagePayment: number;
  /** Portion of `payment` amortizing the financed CMHC premium alone. 0 when not insured. */
  cmhcPayment: number;
  paymentSchedule: PaymentSchedule;
  paymentsPerYear: number;
  numberOfPayments: number;
  minimumDownPayment: number;
  principal: number;
  isInsured: boolean;
  cmhcPremiumRate: number;
  /** One-time CMHC premium amount, financed into totalLoanAmount (not paid up front). */
  cmhcPremium: number;
  totalLoanAmount: number;
}

export type MortgageErrorCode = "INVALID_INPUT" | "DOWN_PAYMENT_TOO_LOW";

export interface ApiErrorBody {
  error: {
    code: MortgageErrorCode;
    message: string;
    field?: string;
  };
}
