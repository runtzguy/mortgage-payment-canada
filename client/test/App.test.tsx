import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/property price/i), "500000");
  await user.type(screen.getByLabelText(/down payment/i), "100000");
  await user.type(screen.getByLabelText(/annual interest rate/i), "5");
}

describe("App", () => {
  it("submits the form and shows the payment on success (uninsured)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        payment: 2326.42,
        mortgagePayment: 2326.42,
        cmhcPayment: 0,
        paymentSchedule: "monthly",
        paymentsPerYear: 12,
        numberOfPayments: 300,
        minimumDownPayment: 25000,
        principal: 400000,
        isInsured: false,
        cmhcPremiumRate: 0,
        cmhcPremium: 0,
        totalLoanAmount: 400000,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      // mortgagePayment and the total both read $2,326.42 when cmhcPayment is 0.
      expect(screen.getAllByText("$2,326.42").length).toBeGreaterThan(0);
    });
    // CMHC payment is still shown explicitly as $0.00, not hidden (appears in both
    // the breakdown row and the CMHC premium detail row).
    expect(screen.getByText("+ CMHC insurance payment")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00").length).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mortgage/payment",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the mortgage payment and CMHC payment separately, adding to the total (insured)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        payment: 2698.35,
        mortgagePayment: 2617.22,
        cmhcPayment: 81.13,
        paymentSchedule: "monthly",
        paymentsPerYear: 12,
        numberOfPayments: 300,
        minimumDownPayment: 25000,
        principal: 450000,
        isInsured: true,
        cmhcPremiumRate: 0.031,
        cmhcPremium: 13950,
        totalLoanAmount: 463950,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/property price/i), "500000");
    await user.type(screen.getByLabelText(/down payment/i), "50000");
    await user.type(screen.getByLabelText(/annual interest rate/i), "5");
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      expect(screen.getByText("Mortgage payment")).toBeInTheDocument();
    });
    expect(screen.getByText("$2,617.22")).toBeInTheDocument();
    expect(screen.getByText("+ CMHC insurance payment")).toBeInTheDocument();
    expect(screen.getByText("$81.13")).toBeInTheDocument();
    expect(screen.getByText("Total payment")).toBeInTheDocument();
    expect(screen.getByText("$2,698.35")).toBeInTheDocument();
  });

  it("shows the server's error message on a 400 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "DOWN_PAYMENT_TOO_LOW",
            message: "Down payment is not enough. Minimum required for a $500,000 property is $25,000.00.",
          },
        },
        400,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/down payment is not enough/i);
    });
  });
});
