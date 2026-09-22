import { useState } from "react";
import type { MortgagePaymentResponse, MortgageRequest } from "@benjipays/shared";
import { fetchMortgagePayment, MortgageApiError } from "./api/mortgage";
import { MortgageForm } from "./components/MortgageForm";
import { PaymentResult } from "./components/PaymentResult";

export function App() {
  const [result, setResult] = useState<MortgagePaymentResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(request: MortgageRequest) {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetchMortgagePayment(request);
      setResult(response);
    } catch (err) {
      setResult(null);
      if (err instanceof MortgageApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Something went wrong. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page">
      <h1>Mortgage Payment Calculator</h1>
      <div className="layout">
        <MortgageForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
        <PaymentResult result={result} errorMessage={errorMessage} />
      </div>
    </main>
  );
}
