import { PAYMENT_SCHEDULE_LABELS, type MortgagePaymentResponse } from "@benjipays/shared";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

interface PaymentResultProps {
  result: MortgagePaymentResponse | null;
  errorMessage: string | null;
  isLoading: boolean;
}

export function PaymentResult({ result, errorMessage, isLoading }: PaymentResultProps) {
  if (isLoading) {
    return <PaymentResultSkeleton />;
  }

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
          <dt>Base principal</dt>
          <dd>{currency.format(result.principal)}</dd>
        </div>
        <div>
          <dt>CMHC premium ({(result.cmhcPremiumRate * 100).toFixed(2)}%, financed)</dt>
          <dd>{currency.format(result.cmhcPremium)}</dd>
        </div>
        <div>
          <dt>Total principal</dt>
          <dd>{currency.format(result.totalLoanAmount)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Mirrors the real result's structure (heading, 3 breakdown rows, 4 detail
 * rows) so the panel doesn't change size when the real content arrives.
 */
function PaymentResultSkeleton() {
  return (
    <div
      className="result-panel"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Calculating payment…"
    >
      <span className="visually-hidden">Calculating payment…</span>
      <div className="skeleton skeleton-heading" aria-hidden="true" />

      <div className="payment-breakdown" aria-hidden="true">
        <div className="payment-breakdown-row">
          <span className="skeleton skeleton-text skeleton-text--label" />
          <span className="skeleton skeleton-text skeleton-text--value" />
        </div>
        <div className="payment-breakdown-row">
          <span className="skeleton skeleton-text skeleton-text--label" />
          <span className="skeleton skeleton-text skeleton-text--value" />
        </div>
        <div className="payment-breakdown-row payment-breakdown-row--total">
          <span className="skeleton skeleton-text skeleton-text--label" />
          <span className="skeleton skeleton-text skeleton-text--value" />
        </div>
      </div>

      <dl className="result-details" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <dt>
              <span className="skeleton skeleton-text skeleton-text--label" />
            </dt>
            <dd>
              <span className="skeleton skeleton-text skeleton-text--value" />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
