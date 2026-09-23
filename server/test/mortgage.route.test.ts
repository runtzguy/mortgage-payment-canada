import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

const validBody = {
  propertyPrice: 500_000,
  downPayment: 100_000,
  annualInterestRate: 5,
  amortizationYears: 25,
  paymentSchedule: "monthly",
};

describe("POST /api/mortgage/payment", () => {
  it("returns 200 with the payment for a valid request", async () => {
    const res = await request(app).post("/api/mortgage/payment").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.payment).toBe(2326.42);
    expect(res.body.mortgagePayment).toBe(2326.42);
    expect(res.body.cmhcPayment).toBe(0);
    expect(res.body.isInsured).toBe(false);
  });

  it("returns 400 DOWN_PAYMENT_TOO_LOW when the down payment is too low", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, downPayment: 5_000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("DOWN_PAYMENT_TOO_LOW");
  });

  it("returns 400 INVALID_INPUT for an amortization not in the allowed set", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, amortizationYears: 12 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT for an unknown payment schedule", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, paymentSchedule: "weekly" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT for a missing field", async () => {
    const { propertyPrice: _omit, ...rest } = validBody;
    const res = await request(app).post("/api/mortgage/payment").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT for a non-numeric value", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, propertyPrice: "five hundred thousand" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT for an ineligible 30-year insured request", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, downPayment: 50_000, amortizationYears: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 200 for an eligible 30-year insured request", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({
        ...validBody,
        downPayment: 50_000,
        amortizationYears: 30,
        isFirstTimeHomeBuyer: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.isInsured).toBe(true);
    expect(res.body.mortgagePayment + res.body.cmhcPayment).toBeCloseTo(res.body.payment, 10);
  });

  it("returns 200 with the non-traditional down payment rate (4.50% at 7% down)", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, downPayment: 35_000, hasNonTraditionalDownPayment: true });
    expect(res.status).toBe(200);
    expect(res.body.cmhcPremiumRate).toBeCloseTo(0.045, 10);
  });

  it("returns 200 with the self-employed rate (4.75% at 12% down)", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, downPayment: 60_000, isSelfEmployedNonVerifiedIncome: true });
    expect(res.status).toBe(200);
    expect(res.body.cmhcPremiumRate).toBeCloseTo(0.0475, 10);
    expect(res.body.minimumDownPayment).toBe(50_000);
  });

  it("returns 400 DOWN_PAYMENT_TOO_LOW for a self-employed applicant under the 10% floor", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, downPayment: 40_000, isSelfEmployedNonVerifiedIncome: true }); // 8% down
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("DOWN_PAYMENT_TOO_LOW");
  });

  it("returns totalMortgage as numberOfPayments * payment for monthly", async () => {
    const res = await request(app).post("/api/mortgage/payment").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.totalMortgage).toBe(res.body.numberOfPayments * res.body.payment);
    expect(res.body.totalMortgageInterest).toBeCloseTo(
      res.body.totalMortgage - res.body.totalLoanAmount,
      10,
    );
  });

  it("returns a simulated (lower) totalMortgage for accelerated-biweekly, not numberOfPayments * payment", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, paymentSchedule: "accelerated-biweekly" });
    expect(res.status).toBe(200);
    const naiveTotal = res.body.numberOfPayments * res.body.payment;
    expect(res.body.totalMortgage).toBeLessThan(naiveTotal);
  });

  it("returns the real payoff count alongside the nominal one for accelerated-biweekly", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .send({ ...validBody, paymentSchedule: "accelerated-biweekly" });
    expect(res.status).toBe(200);
    expect(res.body.numberOfPayments).toBe(650);
    expect(res.body.actualNumberOfPayments).toBeLessThan(650);
    expect(res.body.amortizationYears).toBe(25);
  });

  it("echoes the amortization and an unchanged payment count for monthly", async () => {
    const res = await request(app).post("/api/mortgage/payment").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.amortizationYears).toBe(25);
    expect(res.body.actualNumberOfPayments).toBe(res.body.numberOfPayments);
  });

  it("returns 400 INVALID_INPUT for a malformed JSON body, not 500", async () => {
    const res = await request(app)
      .post("/api/mortgage/payment")
      .set("Content-Type", "application/json")
      .send("{not valid json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });
});

describe("API surface", () => {
  it("returns 200 from the health check", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns a JSON 404 for an unknown /api route, not Express's HTML page", async () => {
    const res = await request(app).post("/api/mortgage/nope").send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns a JSON 404 for the wrong method on the payment route", async () => {
    const res = await request(app).get("/api/mortgage/payment");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
