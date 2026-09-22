import {
  CMHC_PREMIUM_BRACKETS,
  CMHC_THIRTY_YEAR_SURCHARGE,
  INSURED_DOWN_PAYMENT_THRESHOLD,
  INSURED_THIRTY_YEAR_AMORTIZATION,
  MIN_DOWN_PAYMENT_TIER_1_MAX,
  MIN_DOWN_PAYMENT_TIER_1_RATE,
  MIN_DOWN_PAYMENT_TIER_2_MAX,
  MIN_DOWN_PAYMENT_TIER_2_RATE,
  MIN_DOWN_PAYMENT_TIER_3_RATE,
  PAYMENTS_PER_YEAR,
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

/** CMHC premium rate for a given down payment percentage and amortization. 0 when not insured. */
export function cmhcPremiumRate(
  downPaymentPercent: number,
  amortizationYears: number,
): number {
  if (downPaymentPercent >= INSURED_DOWN_PAYMENT_THRESHOLD) {
    return 0;
  }
  const bracket = CMHC_PREMIUM_BRACKETS.find(
    (b) => downPaymentPercent >= b.minPercent && downPaymentPercent < b.maxPercent,
  );
  // Falls through only if downPaymentPercent < 5%, which minimumDownPayment already rejects.
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
  } = request;

  const minDownPayment = minimumDownPayment(propertyPrice);
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

  const rate = isInsured ? cmhcPremiumRate(downPaymentPercent, amortizationYears) : 0;
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
