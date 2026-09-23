import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MortgagePaymentResponse } from "@benjipays/shared";
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

/** A valid, internally-consistent $400k-uninsured-monthly response; override fields per test. */
function baseResponse(overrides: Partial<MortgagePaymentResponse> = {}): MortgagePaymentResponse {
  return {
    payment: 2326.42,
    mortgagePayment: 2326.42,
    cmhcPayment: 0,
    paymentSchedule: "monthly",
    amortizationYears: 25,
    paymentsPerYear: 12,
    numberOfPayments: 300,
    actualNumberOfPayments: 300,
    minimumDownPayment: 25000,
    principal: 400000,
    isInsured: false,
    cmhcPremiumRate: 0,
    cmhcPremium: 0,
    totalLoanAmount: 400000,
    totalMortgage: 697926,
    totalMortgageInterest: 297926,
    ...overrides,
  };
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Property price ($)"), "500000");
  await user.type(screen.getByLabelText("Down payment ($)"), "100000");
  await user.type(screen.getByLabelText(/annual interest rate/i), "5");
}

describe("App", () => {
  it("submits the form and shows the payment on success (uninsured)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));
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
      jsonResponse(
        baseResponse({
          payment: 2698.35,
          mortgagePayment: 2617.22,
          cmhcPayment: 81.13,
          principal: 450000,
          isInsured: true,
          cmhcPremiumRate: 0.031,
          cmhcPremium: 13950,
          totalLoanAmount: 463950,
          totalMortgage: 809505,
          totalMortgageInterest: 345555,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Property price ($)"), "500000");
    await user.type(screen.getByLabelText("Down payment ($)"), "50000");
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

  it("shows Total Mortgage (at the selected years) and Total Mortgage Interest", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      expect(screen.getByText("Total Mortgage at 25 years")).toBeInTheDocument();
    });
    expect(screen.getByText("$697,926.00")).toBeInTheDocument();
    expect(screen.getByText("Total Mortgage Interest")).toBeInTheDocument();
    expect(screen.getByText("$297,926.00")).toBeInTheDocument();
    // No early-payoff caveat for a monthly result, and no "of N scheduled".
    expect(screen.queryByText(/years early/i)).not.toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
  });

  it("shows the accelerated bi-weekly caveat and its simulated (not naive) Total Mortgage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        baseResponse({
          payment: 1163.21,
          mortgagePayment: 1163.21,
          paymentSchedule: "accelerated-biweekly",
          paymentsPerYear: 26,
          numberOfPayments: 650,
          actualNumberOfPayments: 559,
          totalMortgage: 649577.28,
          totalMortgageInterest: 249577.28,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await fillRequiredFields(user);
    await user.selectOptions(screen.getByLabelText(/payment schedule/i), "accelerated-biweekly");
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      expect(screen.getByText("Total Mortgage at 25 years")).toBeInTheDocument();
    });
    expect(screen.getByText("$649,577.28")).toBeInTheDocument();
    // naive would be 650 * 1163.21 = 756,086.50 — must not show that instead.
    expect(screen.queryByText("$756,086.50")).not.toBeInTheDocument();
    // The real payoff count is shown, with the nominal one as context.
    expect(screen.getByText("559 of 650 scheduled")).toBeInTheDocument();
    expect(screen.getByText(/about 3.5 years early/i)).toBeInTheDocument();
  });

  it("shows a skeleton loader while the request is in flight, then the result", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    // While the request is pending: skeleton is showing, real content isn't.
    expect(screen.getByRole("status", { name: /calculating payment/i })).toBeInTheDocument();
    expect(screen.queryByText("Mortgage payment")).not.toBeInTheDocument();

    resolveFetch(jsonResponse(baseResponse()));

    // Once resolved: skeleton is gone, real content is shown.
    await waitFor(() => {
      expect(screen.getByText("Mortgage payment")).toBeInTheDocument();
    });
    expect(screen.queryByRole("status", { name: /calculating payment/i })).not.toBeInTheDocument();
  });

  it("renders the Buyer Info checkboxes and sends them in the request body when checked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await fillRequiredFields(user);
    await user.click(
      screen.getByLabelText(
        "Down payment includes borrowed funds and gift from non-immediate family members?",
      ),
    );
    await user.click(screen.getByLabelText("Self-Employed without third party verification?"));
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.hasNonTraditionalDownPayment).toBe(true);
    expect(body.isSelfEmployedNonVerifiedIncome).toBe(true);
  });

  it("defaults the Buyer Info fields to false when left unchecked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.hasNonTraditionalDownPayment).toBe(false);
    expect(body.isSelfEmployedNonVerifiedIncome).toBe(false);
  });

  it("groups the amount fields in thousands while sending plain numbers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await fillRequiredFields(user);

    // What the user sees.
    expect(screen.getByLabelText("Property price ($)")).toHaveValue("500,000");
    expect(screen.getByLabelText("Down payment ($)")).toHaveValue("100,000");

    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    // What the API receives: no separators.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.propertyPrice).toBe(500000);
    expect(body.downPayment).toBe(100000);
  });

  it("keeps a decimal amount editable and parses it correctly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Property price ($)"), "1234567.89");
    await user.type(screen.getByLabelText("Down payment ($)"), "250000");
    await user.type(screen.getByLabelText(/annual interest rate/i), "5");

    expect(screen.getByLabelText("Property price ($)")).toHaveValue("1,234,567.89");

    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).propertyPrice).toBe(1234567.89);
  });

  it("keeps the caret in place when a digit is inserted mid-number", async () => {
    const user = userEvent.setup();
    render(<App />);

    const price = screen.getByLabelText("Property price ($)") as HTMLInputElement;
    await user.type(price, "500000");
    expect(price).toHaveValue("500,000");

    // Insert a "1" right after the leading "5"; regrouping must not drag the
    // caret to the end, or the rest of the typing lands in the wrong place.
    await user.type(price, "1", { initialSelectionStart: 1, initialSelectionEnd: 1 });
    expect(price).toHaveValue("5,100,000");
    expect(price.selectionStart).toBe(3);
  });

  it("says when a non-traditional down payment does not change the premium", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 10% down: the non-traditional table prices this identically to standard.
    await user.type(screen.getByLabelText("Property price ($)"), "1200000");
    await user.type(screen.getByLabelText("Down payment ($)"), "120000");

    expect(screen.getByText(/priced the same as a traditional down payment/i)).toBeInTheDocument();
  });

  it("says when a non-traditional down payment does raise the premium", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 8.33% down falls in the 5-9.99% band, where the tables differ.
    await user.type(screen.getByLabelText("Property price ($)"), "1200000");
    await user.type(screen.getByLabelText("Down payment ($)"), "100000");

    expect(
      screen.getByText(/Raises the CMHC premium rate for this down payment/i),
    ).toBeInTheDocument();
  });

  it("sends a different body when the non-traditional box is toggled between submits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Property price ($)"), "1200000");
    await user.type(screen.getByLabelText("Down payment ($)"), "100000");
    await user.type(screen.getByLabelText(/annual interest rate/i), "5");

    const calculate = screen.getByRole("button", { name: /calculate payment/i });
    const checkbox = screen.getByLabelText(
      "Down payment includes borrowed funds and gift from non-immediate family members?",
    );

    await user.click(calculate);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(checkbox);
    await user.click(calculate);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const bodyOf = (call: number) =>
      JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string);
    expect(bodyOf(0).hasNonTraditionalDownPayment).toBe(false);
    expect(bodyOf(1).hasNonTraditionalDownPayment).toBe(true);
  });

  it("catches a rule violation with the shared schema before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    // Down payment above the property price violates the schema's refine rule.
    await user.type(screen.getByLabelText("Property price ($)"), "500000");
    await user.type(screen.getByLabelText("Down payment ($)"), "600000");
    await user.type(screen.getByLabelText(/annual interest rate/i), "5");
    await user.click(screen.getByRole("button", { name: /calculate payment/i }));

    await waitFor(() => {
      expect(screen.getByText(/downPayment must be less than propertyPrice/i)).toBeInTheDocument();
    });
    // No round trip needed to learn this.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Down payment ($)")).toHaveAttribute("aria-invalid", "true");
  });

  it("marks the input the server blames when it returns a field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "DOWN_PAYMENT_TOO_LOW",
            message:
              "Down payment is not enough. Minimum required for a $500,000 property is $25,000.00.",
            field: "downPayment",
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
      expect(screen.getByLabelText("Down payment ($)")).toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByLabelText("Down payment ($)")).toHaveAttribute(
      "aria-describedby",
      "downPayment-error",
    );
  });

  it("shows the server's error message on a 400 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "DOWN_PAYMENT_TOO_LOW",
            message:
              "Down payment is not enough. Minimum required for a $500,000 property is $25,000.00.",
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
