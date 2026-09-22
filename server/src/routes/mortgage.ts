import { Router } from "express";
import { MortgageRequestSchema } from "@benjipays/shared";
import { InvalidInputError } from "../errors.js";
import { calculateMortgagePayment } from "../services/mortgage.js";

export const mortgageRouter = Router();

mortgageRouter.post("/payment", (req, res, next) => {
  const parsed = MortgageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const field = firstIssue?.path.join(".") || undefined;
    next(new InvalidInputError(firstIssue?.message ?? "Invalid request.", field));
    return;
  }

  try {
    const result = calculateMortgagePayment(parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
