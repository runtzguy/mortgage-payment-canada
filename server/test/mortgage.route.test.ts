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
});
