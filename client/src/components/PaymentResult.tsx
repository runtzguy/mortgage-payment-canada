import { PAYMENT_SCHEDULE_LABELS, type MortgagePaymentResponse } from "@benjipays/shared";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

interface PaymentResultProps {
  result: MortgagePaymentResponse | null;
  errorMessage: string | null;
}

export function PaymentResult({ result, errorMessage }: PaymentResultProps) {
  if (errorMessage) {
    return (
      <div className="result-panel result-panel--error" role="alert">
        <h2>Couldn't calculate payment</h2>
        <p>{errorMessage}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="result-panel result-panel--empty">
        <p>Fill out the form and submit to see your payment.</p>
      </div>
    );
  }

  return (
    <div className="result-panel">
      <h2>{PAYMENT_SCHEDULE_LABELS[result.paymentSchedule]} payment</h2>

      <div className="payment-breakdown">
        <div className="payment-breakdown-row">
          <span>Mortgage payment</span>
          <span>{currency.format(result.mortgagePayment)}</span>
        </div>
        <div className="payment-breakdown-row">
          <span>+ CMHC insurance payment</span>
          <span>{currency.format(result.cmhcPayment)}</span>
        </div>
        <div className="payment-breakdown-row payment-breakdown-row--total">
          <span>Total payment</span>
          <span>{currency.format(result.payment)}</span>
        </div>
      </div>

      <dl className="result-details">
        <div>
          <dt>Number of payments</dt>
          <dd>{result.numberOfPayments}</dd>
        </div>
        <div>
          <dt>Loan principal</dt>
          <dd>{currency.format(result.principal)}</dd>
        </div>
        <div>
          <dt>CMHC premium ({(result.cmhcPremiumRate * 100).toFixed(2)}%, financed)</dt>
          <dd>{currency.format(result.cmhcPremium)}</dd>
        </div>
        <div>
          <dt>Total loan amount</dt>
          <dd>{currency.format(result.totalLoanAmount)}</dd>
        </div>
      </dl>
    </div>
  );
}
