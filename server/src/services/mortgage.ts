import {
  CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS,
  CMHC_SELF_EMPLOYED_BRACKETS,
  CMHC_STANDARD_BRACKETS,
  CMHC_THIRTY_YEAR_SURCHARGE,
  INSURED_DOWN_PAYMENT_THRESHOLD,
  INSURED_THIRTY_YEAR_AMORTIZATION,
  MIN_DOWN_PAYMENT_TIER_1_MAX,
  MIN_DOWN_PAYMENT_TIER_1_RATE,
  MIN_DOWN_PAYMENT_TIER_2_MAX,
  MIN_DOWN_PAYMENT_TIER_2_RATE,
  MIN_DOWN_PAYMENT_TIER_3_RATE,
  PAYMENTS_PER_YEAR,
  SELF_EMPLOYED_MINIMUM_DOWN_PAYMENT_RATE,
  type CmhcPremiumBracket,
  type MortgagePaymentResponse,
  type MortgageRequest,
} from "@benjipays/shared";
import { DownPaymentTooLowError, InvalidInputError } from "../errors.js";

/** Pure calculation logic — no HTTP concerns, so it's directly unit-testable. */

/** Canadian tiered minimum down payment rule. */
export function minimumDownPayment(propertyPrice: number): number {
  if (propertyPrice <= MIN_DOWN_PAYMENT_TIER_1_MAX) {
    return propertyPrice * MIN_DOWN_PAYMENT_TIER_1_RATE;
  }
  if (propertyPrice < MIN_DOWN_PAYMENT_TIER_2_MAX) {
    const tier1 = MIN_DOWN_PAYMENT_TIER_1_MAX * MIN_DOWN_PAYMENT_TIER_1_RATE;
    const tier2 = (propertyPrice - MIN_DOWN_PAYMENT_TIER_1_MAX) * MIN_DOWN_PAYMENT_TIER_2_RATE;
    return tier1 + tier2;
  }
  return propertyPrice * MIN_DOWN_PAYMENT_TIER_3_RATE;
}

/**
 * Minimum down payment actually required, given the standard tiered rule plus
 * the self-employed (non-verified income) floor of 10% when it applies. The
 * floor is a `max`, not a replacement: it only raises the requirement (it's
 * stricter than the standard tiered minimum everywhere below $1.5M) and never
 * lowers the existing 20% minimum at $1.5M+.
 */
export function effectiveMinimumDownPayment(
  propertyPrice: number,
  isSelfEmployedNonVerifiedIncome: boolean,
): number {
  const standardMinimum = minimumDownPayment(propertyPrice);
  if (!isSelfEmployedNonVerifiedIncome) {
    return standardMinimum;
  }
  return Math.max(standardMinimum, propertyPrice * SELF_EMPLOYED_MINIMUM_DOWN_PAYMENT_RATE);
}

/**
 * Which CMHC premium bracket table applies. Self-employed (non-verified
 * income) takes priority when both flags are set — its rules, including the
 * minimum down payment floor, fully supersede the non-traditional table.
 */
export function selectCmhcBracketTable(
  hasNonTraditionalDownPayment: boolean,
  isSelfEmployedNonVerifiedIncome: boolean,
): ReadonlyArray<CmhcPremiumBracket> {
  if (isSelfEmployedNonVerifiedIncome) {
    return CMHC_SELF_EMPLOYED_BRACKETS;
  }
  if (hasNonTraditionalDownPayment) {
    return CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS;
  }
  return CMHC_STANDARD_BRACKETS;
}

/** CMHC premium rate for a given down payment percentage and amortization. 0 when not insured. */
export function cmhcPremiumRate(
  downPaymentPercent: number,
  amortizationYears: number,
  brackets: ReadonlyArray<CmhcPremiumBracket> = CMHC_STANDARD_BRACKETS,
): number {
  if (downPaymentPercent >= INSURED_DOWN_PAYMENT_THRESHOLD) {
    return 0;
  }
  const bracket = brackets.find(
    (b) => downPaymentPercent >= b.minPercent && downPaymentPercent < b.maxPercent,
  );
  // Falls through only if downPaymentPercent is below the table's lowest bracket,
  // which effectiveMinimumDownPayment already rejects for each table's floor.
  let rate = bracket?.rate ?? 0;
  if (amortizationYears === INSURED_THIRTY_YEAR_AMORTIZATION) {
    rate += CMHC_THIRTY_YEAR_SURCHARGE;
  }
  return rate;
}

/** Periodic (per-payment) rate from the annual rate, using Canadian semi-annual compounding. */
export function periodicRate(annualRateDecimal: number, paymentsPerYear: number): number {
  if (annualRateDecimal === 0) return 0;
  return Math.pow(1 + annualRateDecimal / 2, 2 / paymentsPerYear) - 1;
}

/** Standard amortized payment formula: P = L * i / (1 - (1+i)^-n). */
export function amortizedPayment(
  loanAmount: number,
  periodicInterestRate: number,
  numberOfPayments: number,
): number {
  if (periodicInterestRate === 0) return loanAmount / numberOfPayments;
  return (
    (loanAmount * periodicInterestRate) /
    (1 - Math.pow(1 + periodicInterestRate, -numberOfPayments))
  );
}

function roundToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateMortgagePayment(request: MortgageRequest): MortgagePaymentResponse {
  const {
    propertyPrice,
    downPayment,
    annualInterestRate,
    amortizationYears,
    paymentSchedule,
    isFirstTimeHomeBuyer,
    isNewConstruction,
    hasNonTraditionalDownPayment,
    isSelfEmployedNonVerifiedIncome,
  } = request;

  const minDownPayment = effectiveMinimumDownPayment(
    propertyPrice,
    isSelfEmployedNonVerifiedIncome,
  );
  if (downPayment < minDownPayment) {
    throw new DownPaymentTooLowError(propertyPrice, minDownPayment);
  }

  const principal = propertyPrice - downPayment;
  const downPaymentPercent = downPayment / propertyPrice;
  const isInsured = downPaymentPercent < INSURED_DOWN_PAYMENT_THRESHOLD;

  if (isInsured && amortizationYears === INSURED_THIRTY_YEAR_AMORTIZATION) {
    const eligible = isFirstTimeHomeBuyer || isNewConstruction;
    if (!eligible) {
      throw new InvalidInputError(
        "30-year amortization is only available for insured mortgages when the buyer is a first-time home buyer or is purchasing a newly constructed home.",
        "amortizationYears",
      );
    }
  }

  const brackets = selectCmhcBracketTable(
    hasNonTraditionalDownPayment,
    isSelfEmployedNonVerifiedIncome,
  );
  const rate = isInsured ? cmhcPremiumRate(downPaymentPercent, amortizationYears, brackets) : 0;
  const premium = principal * rate;
  const totalLoanAmount = principal + premium;

  const annualRateDecimal = annualInterestRate / 100;
  const paymentsPerYear = PAYMENTS_PER_YEAR[paymentSchedule];

  // The amortization formula is linear in the loan amount (rate and number of
  // payments held fixed), so amortizedPayment(principal) + amortizedPayment(premium)
  // equals amortizedPayment(principal + premium) exactly, before rounding. That lets
  // the mortgage portion and the CMHC portion of the payment be split out for display
  // while still summing to the same total the client would get from totalLoanAmount alone.
  let mortgagePaymentRaw: number;
  let cmhcPaymentRaw: number;
  let numberOfPayments: number;

  if (paymentSchedule === "accelerated-biweekly") {
    // Derived from the monthly payment, not amortized independently: half the
    // monthly payment, paid 26 times a year instead of 24, which is what
    // makes it "accelerated" (see services/mortgage.test.ts for the math).
    const monthlyRate = periodicRate(annualRateDecimal, 12);
    const monthlyPayments = amortizationYears * 12;
    mortgagePaymentRaw = amortizedPayment(principal, monthlyRate, monthlyPayments) / 2;
    cmhcPaymentRaw = amortizedPayment(premium, monthlyRate, monthlyPayments) / 2;
    numberOfPayments = amortizationYears * 26;
  } else {
    numberOfPayments = amortizationYears * paymentsPerYear;
    const rateForSchedule = periodicRate(annualRateDecimal, paymentsPerYear);
    mortgagePaymentRaw = amortizedPayment(principal, rateForSchedule, numberOfPayments);
    cmhcPaymentRaw = amortizedPayment(premium, rateForSchedule, numberOfPayments);
  }

  // Round the two displayed line items first, then derive the total from them,
  // so the client's own mortgagePayment + cmhcPayment always equals `payment`
  // exactly — never off by a cent from rounding the combined amount separately.
  const mortgagePayment = roundToCents(mortgagePaymentRaw);
  const cmhcPayment = roundToCents(cmhcPaymentRaw);
  const payment = roundToCents(mortgagePayment + cmhcPayment);

  return {
    payment,
    mortgagePayment,
    cmhcPayment,
    paymentSchedule,
    paymentsPerYear,
    numberOfPayments,
    minimumDownPayment: roundToCents(minDownPayment),
    principal: roundToCents(principal),
    isInsured,
    cmhcPremiumRate: rate,
    cmhcPremium: roundToCents(premium),
    totalLoanAmount: roundToCents(totalLoanAmount),
  };
}
