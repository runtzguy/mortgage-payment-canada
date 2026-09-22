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
  it("submits the form and shows the payment on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        payment: 2326.42,
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
      expect(screen.getByText("$2,326.42")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mortgage/payment",
      expect.objectContaining({ method: "POST" }),
    );
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
