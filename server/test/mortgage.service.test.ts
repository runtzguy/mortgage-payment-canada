import { describe, expect, it } from "vitest";
import {
  amortizedPayment,
  calculateMortgagePayment,
  cmhcPremiumRate,
  minimumDownPayment,
  periodicRate,
} from "../src/services/mortgage.js";
import { DownPaymentTooLowError, InvalidInputError } from "../src/errors.js";
import type { MortgageRequest } from "@benjipays/shared";

function request(overrides: Partial<MortgageRequest> = {}): MortgageRequest {
  return {
    propertyPrice: 500_000,
    downPayment: 100_000,
    annualInterestRate: 5,
    amortizationYears: 25,
    paymentSchedule: "monthly",
    isFirstTimeHomeBuyer: false,
    isNewConstruction: false,
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
      calculateMortgagePayment(
        request({ downPayment: 50_000, amortizationYears: 30 }),
      ),
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
});
