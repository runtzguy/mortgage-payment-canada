import {
  cmhcBracketRate,
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
  const bracketRate = cmhcBracketRate(brackets, downPaymentPercent);
  if (bracketRate === undefined) {
    // Unreachable: each table's lowest bracket is guarded by the matching
    // floor in effectiveMinimumDownPayment. If a future rate table leaves a
    // gap, fail loudly — silently returning 0 would hand out an insured
    // mortgage with no premium.
    throw new Error(
      `No CMHC premium bracket covers a down payment of ${(downPaymentPercent * 100).toFixed(2)}%.`,
    );
  }
  let rate = bracketRate;
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
  // The epsilon has to be added AFTER scaling: at money magnitudes
  // `amount + Number.EPSILON === amount`, so nudging before the multiply is a
  // no-op and does nothing for a value sitting exactly on a .005 boundary.
  return Math.round(amount * 100 + Number.EPSILON) / 100;
}

export interface AcceleratedPayoff {
  /** Total amount handed over across the whole payoff. */
  totalPaid: number;
  /** Payments actually made before the balance cleared. */
  periods: number;
}

/**
 * True payoff of an accelerated bi-weekly mortgage, simulated period by
 * period: interest accrues on the outstanding balance at the bi-weekly
 * periodic rate, then the fixed accelerated payment is applied. The loan is
 * paid off in fewer than the nominal `years * 26` periods because that fixed
 * payment (half the monthly payment, paid 26x/year) overpays relative to what
 * a true bi-weekly amortization at that rate would need — that's what
 * "accelerated" means. The final period's payment is capped to exactly clear
 * the remaining balance rather than overshooting it.
 */
export function simulateAcceleratedBiweeklyPayoff(
  totalLoanAmount: number,
  fixedPayment: number,
  annualRateDecimal: number,
): AcceleratedPayoff {
  const biweeklyRate = periodicRate(annualRateDecimal, 26);
  let balance = totalLoanAmount;
  let totalPaid = 0;
  let periods = 0;
  // Safety cap: a well-formed accelerated schedule always pays off well
  // within the longest allowed nominal term (30 years of biweekly periods).
  const maxIterations = 30 * 26;
  while (balance > 0 && periods < maxIterations) {
    balance += balance * biweeklyRate;
    periods += 1;
    if (balance <= fixedPayment) {
      totalPaid += balance;
      balance = 0;
    } else {
      balance -= fixedPayment;
      totalPaid += fixedPayment;
    }
  }
  // Defensive fallback; should be unreachable given how the payment is sized.
  if (balance > 0) {
    totalPaid += balance;
  }
  return { totalPaid, periods };
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
  const totalLoanAmountRounded = roundToCents(totalLoanAmount);

  // For monthly/biweekly, numberOfPayments * payment is exact by construction
  // (that's what the amortization formula solved for) and every payment is
  // made. Accelerated-biweekly pays off before its nominal numberOfPayments,
  // so it needs simulation — see simulateAcceleratedBiweeklyPayoff for why.
  let totalMortgage: number;
  let actualNumberOfPayments: number;
  if (paymentSchedule === "accelerated-biweekly") {
    const payoff = simulateAcceleratedBiweeklyPayoff(
      totalLoanAmountRounded,
      payment,
      annualRateDecimal,
    );
    totalMortgage = roundToCents(payoff.totalPaid);
    actualNumberOfPayments = payoff.periods;
  } else {
    totalMortgage = roundToCents(numberOfPayments * payment);
    actualNumberOfPayments = numberOfPayments;
  }
  const totalMortgageInterest = roundToCents(totalMortgage - totalLoanAmountRounded);

  return {
    payment,
    mortgagePayment,
    cmhcPayment,
    paymentSchedule,
    amortizationYears,
    paymentsPerYear,
    numberOfPayments,
    actualNumberOfPayments,
    minimumDownPayment: roundToCents(minDownPayment),
    principal: roundToCents(principal),
    isInsured,
    cmhcPremiumRate: rate,
    cmhcPremium: roundToCents(premium),
    totalLoanAmount: totalLoanAmountRounded,
    totalMortgage,
    totalMortgageInterest,
  };
}
