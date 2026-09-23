import { useState } from "react";
import type { MortgagePaymentResponse, MortgageRequest } from "@benjipays/shared";
import { fetchMortgagePayment, MortgageApiError } from "./api/mortgage";
import { MortgageForm, type ServerError } from "./components/MortgageForm";
import { PaymentResult } from "./components/PaymentResult";

export function App() {
  const [result, setResult] = useState<MortgagePaymentResponse | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(request: MortgageRequest) {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetchMortgagePayment(request);
      setResult(response);
    } catch (err) {
      setResult(null);
      if (err instanceof MortgageApiError) {
        // `field` lets the form mark the offending input, not just the panel.
        setError({ message: err.message, field: err.field });
      } else {
        setError({ message: "Something went wrong. Please try again." });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page">
      <h1>Mortgage Payment Calculator</h1>
      <div className="layout">
        <MortgageForm onSubmit={handleSubmit} isSubmitting={isSubmitting} serverError={error} />
        <PaymentResult
          result={result}
          errorMessage={error?.message ?? null}
          isLoading={isSubmitting}
        />
      </div>
    </main>
  );
}
