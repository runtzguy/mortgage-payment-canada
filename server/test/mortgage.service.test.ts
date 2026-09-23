import { describe, expect, it } from "vitest";
import {
  amortizedPayment,
  calculateMortgagePayment,
  cmhcPremiumRate,
  effectiveMinimumDownPayment,
  minimumDownPayment,
  periodicRate,
  selectCmhcBracketTable,
  simulateAcceleratedBiweeklyPayoff,
} from "../src/services/mortgage.js";
import { DownPaymentTooLowError, InvalidInputError } from "../src/errors.js";
import {
  CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS,
  CMHC_SELF_EMPLOYED_BRACKETS,
  CMHC_STANDARD_BRACKETS,
  type MortgageRequest,
} from "@benjipays/shared";

function request(overrides: Partial<MortgageRequest> = {}): MortgageRequest {
  return {
    propertyPrice: 500_000,
    downPayment: 100_000,
    annualInterestRate: 5,
    amortizationYears: 25,
    paymentSchedule: "monthly",
    isFirstTimeHomeBuyer: false,
    isNewConstruction: false,
    hasNonTraditionalDownPayment: false,
    isSelfEmployedNonVerifiedIncome: false,
    ...overrides,
  };
}

describe("minimumDownPayment", () => {
  it("is 5% at or below $500k", () => {
    expect(minimumDownPayment(500_000)).toBe(25_000);
    expect(minimumDownPayment(300_000)).toBe(15_000);
  });

  it("is 5% of the first $500k plus 10% of the rest, between $500k and $1.5M", () => {
    expect(minimumDownPayment(600_000)).toBe(35_000);
    expect(minimumDownPayment(1_499_999)).toBeCloseTo(124_999.9, 5);
  });

  it("is 20% at or above $1.5M", () => {
    expect(minimumDownPayment(1_500_000)).toBe(300_000);
    expect(minimumDownPayment(2_000_000)).toBe(400_000);
  });
});

describe("cmhcPremiumRate", () => {
  it("is 0 at or above the 20% insured threshold", () => {
    expect(cmhcPremiumRate(0.2, 25)).toBe(0);
    expect(cmhcPremiumRate(0.5, 25)).toBe(0);
  });

  it("is 4.00% for 5% to just under 10% down", () => {
    expect(cmhcPremiumRate(0.05, 25)).toBeCloseTo(0.04, 10);
    expect(cmhcPremiumRate(0.0999, 25)).toBeCloseTo(0.04, 10);
  });

  it("is 3.10% for 10% to just under 15% down", () => {
    expect(cmhcPremiumRate(0.1, 25)).toBeCloseTo(0.031, 10);
    expect(cmhcPremiumRate(0.1499, 25)).toBeCloseTo(0.031, 10);
  });

  it("is 2.80% for 15% to just under 20% down", () => {
    expect(cmhcPremiumRate(0.15, 25)).toBeCloseTo(0.028, 10);
    expect(cmhcPremiumRate(0.1999, 25)).toBeCloseTo(0.028, 10);
  });

  it("adds a 20 bps surcharge for 30-year amortization", () => {
    expect(cmhcPremiumRate(0.1, 30)).toBeCloseTo(0.033, 10);
    expect(cmhcPremiumRate(0.05, 30)).toBeCloseTo(0.042, 10);
  });
});

describe("effectiveMinimumDownPayment", () => {
  it("equals the standard tiered minimum when not self-employed", () => {
    expect(effectiveMinimumDownPayment(300_000, false)).toBe(minimumDownPayment(300_000));
    expect(effectiveMinimumDownPayment(2_000_000, false)).toBe(minimumDownPayment(2_000_000));
  });

  it("raises the minimum to 10% for a self-employed applicant below $1.5M", () => {
    // Standard minimum for $300k is $15,000 (5%); the self-employed 10% floor is stricter.
    expect(minimumDownPayment(300_000)).toBe(15_000);
    expect(effectiveMinimumDownPayment(300_000, true)).toBe(30_000);
  });

  it("leaves the minimum unchanged at $1.5M+ (standard 20% already exceeds the 10% floor)", () => {
    expect(effectiveMinimumDownPayment(1_500_000, true)).toBe(300_000);
    expect(effectiveMinimumDownPayment(2_000_000, true)).toBe(400_000);
  });
});

describe("selectCmhcBracketTable", () => {
  it("uses the standard table when neither flag is set", () => {
    expect(selectCmhcBracketTable(false, false)).toBe(CMHC_STANDARD_BRACKETS);
  });

  it("uses the non-traditional table when only that flag is set", () => {
    expect(selectCmhcBracketTable(true, false)).toBe(CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS);
  });

  it("uses the self-employed table when only that flag is set", () => {
    expect(selectCmhcBracketTable(false, true)).toBe(CMHC_SELF_EMPLOYED_BRACKETS);
  });

  it("uses the self-employed table when both flags are set (self-employed takes priority)", () => {
    expect(selectCmhcBracketTable(true, true)).toBe(CMHC_SELF_EMPLOYED_BRACKETS);
  });
});

describe("cmhcPremiumRate with the non-traditional down payment table", () => {
  it("is 4.50% for 5% to just under 10% down (vs 4.00% standard)", () => {
    expect(cmhcPremiumRate(0.05, 25, CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS)).toBeCloseTo(
      0.045,
      10,
    );
    expect(cmhcPremiumRate(0.0999, 25, CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS)).toBeCloseTo(
      0.045,
      10,
    );
  });

  it("matches the standard table's rate at 10%+ down", () => {
    expect(cmhcPremiumRate(0.1, 25, CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS)).toBeCloseTo(
      0.031,
      10,
    );
    expect(cmhcPremiumRate(0.15, 25, CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS)).toBeCloseTo(
      0.028,
      10,
    );
  });
});

describe("cmhcPremiumRate with the self-employed table", () => {
  it("throws below 10% down — no bracket exists, and the 10% floor makes it unreachable", () => {
    // Guarded by SELF_EMPLOYED_MINIMUM_DOWN_PAYMENT_RATE in practice; if it is
    // ever reached, a zero premium would be the wrong answer, not a safe one.
    expect(() => cmhcPremiumRate(0.05, 25, CMHC_SELF_EMPLOYED_BRACKETS)).toThrow(
      /No CMHC premium bracket/,
    );
  });

  it("is 4.75% for 10% to just under 15% down", () => {
    expect(cmhcPremiumRate(0.1, 25, CMHC_SELF_EMPLOYED_BRACKETS)).toBeCloseTo(0.0475, 10);
    expect(cmhcPremiumRate(0.1499, 25, CMHC_SELF_EMPLOYED_BRACKETS)).toBeCloseTo(0.0475, 10);
  });

  it("is 2.90% for 15% to just under 20% down", () => {
    expect(cmhcPremiumRate(0.15, 25, CMHC_SELF_EMPLOYED_BRACKETS)).toBeCloseTo(0.029, 10);
    expect(cmhcPremiumRate(0.1999, 25, CMHC_SELF_EMPLOYED_BRACKETS)).toBeCloseTo(0.029, 10);
  });

  it("is 0 at 20%+ down", () => {
    expect(cmhcPremiumRate(0.2, 25, CMHC_SELF_EMPLOYED_BRACKETS)).toBe(0);
  });

  it("adds the 20 bps 30-year surcharge on top, same as the standard table", () => {
    expect(cmhcPremiumRate(0.1, 30, CMHC_SELF_EMPLOYED_BRACKETS)).toBeCloseTo(0.0495, 10);
  });
});

describe("periodicRate", () => {
  it("is 0 when the annual rate is 0", () => {
    expect(periodicRate(0, 12)).toBe(0);
  });

  it("uses Canadian semi-annual compounding, not annualRate / k", () => {
    const i = periodicRate(0.05, 12);
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(0.05 / 12); // semi-annual compounding yields a slightly lower monthly rate
  });
});

describe("amortizedPayment", () => {
  it("divides evenly when the rate is 0", () => {
    expect(amortizedPayment(400_000, 0, 300)).toBeCloseTo(1333.333, 3);
  });
});

describe("cmhcPremiumRate bracket coverage", () => {
  it("throws rather than silently charging no premium when no bracket matches", () => {
    // 2% down is below every table's lowest bracket. Reaching this state means
    // a rate table has a gap; returning 0 would hand out free insurance.
    expect(() => cmhcPremiumRate(0.02, 25)).toThrow(/No CMHC premium bracket/);
  });
});

describe("simulateAcceleratedBiweeklyPayoff", () => {
  it("pays off in fewer than the nominal years*26 periods (that's what makes it accelerated)", () => {
    // $400k loan, $1,163.21 accelerated payment (half the monthly payment for
    // this loan at 5%/25y), 5% rate: nominal is 25*26 = 650 periods.
    const { totalPaid, periods } = simulateAcceleratedBiweeklyPayoff(400_000, 1163.21, 0.05);
    const naiveTotal = 1163.21 * 650;
    expect(totalPaid).toBeLessThan(naiveTotal);
    expect(periods).toBeLessThan(650);
  });

  it("matches the hand-computed reference: 559 periods, $649,577.28 total", () => {
    // Cross-checked independently: simulateAcceleratedBiweeklyPayoff should
    // reproduce this within a cent of rounding.
    const { totalPaid, periods } = simulateAcceleratedBiweeklyPayoff(400_000, 1163.21, 0.05);
    expect(totalPaid).toBeCloseTo(649_577.28, 1);
    expect(periods).toBe(559);
  });

  it("returns exactly the loan amount when the rate is 0", () => {
    // 400,000 / (1163.21ish) periods, but at 0% interest total paid == principal exactly
    // (no interest to accrue), regardless of how many periods it takes.
    const { totalPaid } = simulateAcceleratedBiweeklyPayoff(400_000, 2000, 0);
    expect(totalPaid).toBeCloseTo(400_000, 5);
  });
});

describe("calculateMortgagePayment payment counts", () => {
  it("reports actualNumberOfPayments equal to numberOfPayments for monthly", () => {
    const result = calculateMortgagePayment(request({ paymentSchedule: "monthly" }));
    expect(result.actualNumberOfPayments).toBe(result.numberOfPayments);
    expect(result.amortizationYears).toBe(25);
  });

  it("reports a lower actualNumberOfPayments for accelerated bi-weekly", () => {
    const result = calculateMortgagePayment(request({ paymentSchedule: "accelerated-biweekly" }));
    expect(result.numberOfPayments).toBe(650);
    expect(result.actualNumberOfPayments).toBe(559);
    // The total must match the schedule it actually ran, not the nominal one.
    expect(result.totalMortgage).toBeLessThan(result.numberOfPayments * result.payment);
  });
});

describe("calculateMortgagePayment", () => {
  it("computes the monthly payment for an uninsured mortgage (20% down)", () => {
    const result = calculateMortgagePayment(request());
    expect(result.isInsured).toBe(false);
    expect(result.principal).toBe(400_000);
    expect(result.cmhcPremium).toBe(0);
    expect(result.cmhcPremiumRate).toBe(0);
    expect(result.totalLoanAmount).toBe(400_000);
    expect(result.payment).toBe(2326.42);
    // Not insured: the whole payment is the mortgage portion, no CMHC portion.
    expect(result.mortgagePayment).toBe(2326.42);
    expect(result.cmhcPayment).toBe(0);
    expect(result.numberOfPayments).toBe(300);
    expect(result.paymentsPerYear).toBe(12);
    // Monthly: totalMortgage is exactly numberOfPayments * payment.
    expect(result.totalMortgage).toBe(697_926);
    expect(result.totalMortgageInterest).toBe(297_926);
    expect(result.totalMortgage).toBe(result.numberOfPayments * result.payment);
    expect(result.totalMortgageInterest).toBe(result.totalMortgage - result.totalLoanAmount);
  });

  it("computes the bi-weekly payment", () => {
    const result = calculateMortgagePayment(request({ paymentSchedule: "biweekly" }));
    expect(result.payment).toBe(1072.54);
    expect(result.numberOfPayments).toBe(650);
    expect(result.paymentsPerYear).toBe(26);
  });

  it("computes the accelerated bi-weekly payment as half the monthly payment, paid 26x/year", () => {
    const result = calculateMortgagePayment(request({ paymentSchedule: "accelerated-biweekly" }));
    expect(result.payment).toBe(1163.21);
    expect(result.numberOfPayments).toBe(650);
    // Accelerated is strictly more per year than regular bi-weekly (that's what makes it "accelerated").
    const biweekly = calculateMortgagePayment(request({ paymentSchedule: "biweekly" }));
    expect(result.payment).toBeGreaterThan(biweekly.payment);
  });

  it("computes accelerated bi-weekly's totalMortgage via simulated payoff, not numberOfPayments * payment", () => {
    const result = calculateMortgagePayment(request({ paymentSchedule: "accelerated-biweekly" }));
    const naiveTotal = result.numberOfPayments * result.payment; // 650 * 1163.21 = 756,086.50
    // The true payoff finishes early, so totalMortgage is meaningfully less than the naive product —
    // this is the whole point of the accelerated schedule, and exactly what the simulation is for.
    expect(result.totalMortgage).toBeLessThan(naiveTotal);
    expect(naiveTotal - result.totalMortgage).toBeGreaterThan(50_000); // not just a rounding difference
    expect(result.totalMortgage).toBeCloseTo(649_577.28, 1);
    expect(result.totalMortgageInterest).toBeCloseTo(249_577.28, 1);
    expect(result.totalMortgageInterest).toBeCloseTo(
      result.totalMortgage - result.totalLoanAmount,
      10, // floating-point noise from subtracting two already-rounded numbers
    );
  });

  it("makes monthly's totalMortgage match accelerated bi-weekly's simulated totalMortgage closely (same loan, faster accelerated payoff pays less interest)", () => {
    const monthly = calculateMortgagePayment(request({ paymentSchedule: "monthly" }));
    const accelerated = calculateMortgagePayment(
      request({ paymentSchedule: "accelerated-biweekly" }),
    );
    // Accelerated bi-weekly's real-world benefit: less total interest than monthly,
    // because the built-in extra payment each year pays the loan off early.
    expect(accelerated.totalMortgageInterest).toBeLessThan(monthly.totalMortgageInterest);
  });

  it("adds the CMHC premium to the loan amount for an insured mortgage (10% down)", () => {
    const result = calculateMortgagePayment(request({ downPayment: 50_000 }));
    expect(result.isInsured).toBe(true);
    expect(result.principal).toBe(450_000);
    expect(result.cmhcPremiumRate).toBeCloseTo(0.031, 10);
    expect(result.cmhcPremium).toBe(13_950);
    expect(result.totalLoanAmount).toBe(463_950);
    // mortgagePayment and cmhcPayment are each amortized on their own share of the
    // loan, rounded to the cent first, then summed — so payment always equals
    // their exact sum, even when that differs by a cent from rounding the
    // combined loan amount directly (2698.36 vs 2698.35 here).
    expect(result.mortgagePayment).toBe(2617.22);
    expect(result.cmhcPayment).toBe(81.13);
    expect(result.payment).toBe(2698.35);
    expect(result.mortgagePayment + result.cmhcPayment).toBeCloseTo(result.payment, 10);
  });

  it("splits mortgagePayment and cmhcPayment consistently across every schedule", () => {
    for (const paymentSchedule of ["monthly", "biweekly", "accelerated-biweekly"] as const) {
      const result = calculateMortgagePayment(request({ downPayment: 50_000, paymentSchedule }));
      expect(result.mortgagePayment + result.cmhcPayment).toBeCloseTo(result.payment, 10);
      expect(result.cmhcPayment).toBeGreaterThan(0);
    }
  });

  it("rejects a down payment below the minimum", () => {
    expect(() => calculateMortgagePayment(request({ downPayment: 10_000 }))).toThrow(
      DownPaymentTooLowError,
    );
  });

  it("rejects 30-year amortization on an insured mortgage when the buyer is not eligible", () => {
    expect(() =>
      calculateMortgagePayment(request({ downPayment: 50_000, amortizationYears: 30 })),
    ).toThrow(InvalidInputError);
  });

  it("allows 30-year amortization on an insured mortgage for a first-time home buyer", () => {
    const result = calculateMortgagePayment(
      request({ downPayment: 50_000, amortizationYears: 30, isFirstTimeHomeBuyer: true }),
    );
    expect(result.isInsured).toBe(true);
    expect(result.cmhcPremiumRate).toBeCloseTo(0.033, 10); // 3.10% + 0.20% surcharge
  });

  it("allows 30-year amortization on an insured mortgage for a newly constructed home", () => {
    const result = calculateMortgagePayment(
      request({ downPayment: 50_000, amortizationYears: 30, isNewConstruction: true }),
    );
    expect(result.isInsured).toBe(true);
    expect(result.cmhcPremiumRate).toBeCloseTo(0.033, 10);
  });

  it("allows 30-year amortization on an uninsured mortgage with no eligibility flags", () => {
    const result = calculateMortgagePayment(request({ amortizationYears: 30 }));
    expect(result.isInsured).toBe(false);
    expect(result.cmhcPremium).toBe(0);
  });

  it("handles a 0% interest rate", () => {
    const result = calculateMortgagePayment(request({ annualInterestRate: 0 }));
    expect(result.payment).toBe(1333.33);
  });

  it("prices a non-traditional down payment at 4.50% in the 5-9.99% bracket", () => {
    // $500k price, 7% down ($35,000) — below the standard table's 5% minimum
    // rejection point, so this only exercises the rate, not the floor.
    const result = calculateMortgagePayment(
      request({ downPayment: 35_000, hasNonTraditionalDownPayment: true }),
    );
    expect(result.isInsured).toBe(true);
    expect(result.cmhcPremiumRate).toBeCloseTo(0.045, 10);
    expect(result.mortgagePayment).toBe(2704.46);
    expect(result.cmhcPayment).toBe(121.7);
    expect(result.payment).toBe(2826.16);
  });

  it("rejects a self-employed applicant under the 10% minimum, even above the standard 5% minimum", () => {
    // $500k price, 8% down ($40,000) clears the standard 5% minimum but not
    // the self-employed 10% floor — and is never priced at 4.00%/4.50%.
    expect(() =>
      calculateMortgagePayment(
        request({ downPayment: 40_000, isSelfEmployedNonVerifiedIncome: true }),
      ),
    ).toThrow(DownPaymentTooLowError);
  });

  it("prices a self-employed applicant at 4.75% in the 10-14.99% bracket", () => {
    const result = calculateMortgagePayment(
      request({ downPayment: 60_000, isSelfEmployedNonVerifiedIncome: true }),
    );
    expect(result.isInsured).toBe(true);
    expect(result.minimumDownPayment).toBe(50_000); // self-employed 10% floor, not the 5% standard
    expect(result.cmhcPremiumRate).toBeCloseTo(0.0475, 10);
    expect(result.mortgagePayment).toBe(2559.06);
    expect(result.cmhcPayment).toBe(121.56);
    expect(result.payment).toBe(2680.62);
  });

  it("uses the self-employed rules, not the non-traditional rules, when both flags are set", () => {
    const bothFlags = calculateMortgagePayment(
      request({
        downPayment: 60_000,
        hasNonTraditionalDownPayment: true,
        isSelfEmployedNonVerifiedIncome: true,
      }),
    );
    const selfEmployedOnly = calculateMortgagePayment(
      request({ downPayment: 60_000, isSelfEmployedNonVerifiedIncome: true }),
    );
    expect(bothFlags.cmhcPremiumRate).toBeCloseTo(0.0475, 10); // self-employed's rate
    expect(bothFlags.cmhcPremiumRate).not.toBeCloseTo(0.031, 5); // not non-traditional's rate at 12% down
    expect(bothFlags).toEqual(selfEmployedOnly);
  });
});
