import { useState } from "react";
import type { FormEvent } from "react";
import {
  AMORTIZATION_YEARS_OPTIONS,
  PAYMENT_SCHEDULES,
  PAYMENT_SCHEDULE_LABELS,
  type AmortizationYears,
  type MortgageRequest,
  type PaymentSchedule,
} from "@benjipays/shared";

interface FormState {
  propertyPrice: string;
  downPayment: string;
  annualInterestRate: string;
  amortizationYears: AmortizationYears;
  paymentSchedule: PaymentSchedule;
  isFirstTimeHomeBuyer: boolean;
  isNewConstruction: boolean;
  hasNonTraditionalDownPayment: boolean;
  isSelfEmployedNonVerifiedIncome: boolean;
}

const initialState: FormState = {
  propertyPrice: "",
  downPayment: "",
  annualInterestRate: "",
  amortizationYears: 25,
  paymentSchedule: "monthly",
  isFirstTimeHomeBuyer: false,
  isNewConstruction: false,
  hasNonTraditionalDownPayment: false,
  isSelfEmployedNonVerifiedIncome: false,
};

interface MortgageFormProps {
  onSubmit: (request: MortgageRequest) => void;
  isSubmitting: boolean;
}

export function MortgageForm({ onSubmit, isSubmitting }: MortgageFormProps) {
  const [form, setForm] = useState<FormState>(initialState);

  const isInsuredCandidate =
    form.propertyPrice !== "" &&
    form.downPayment !== "" &&
    Number(form.downPayment) < 0.2 * Number(form.propertyPrice);
  const showEligibilityFields = isInsuredCandidate && form.amortizationYears === 30;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      propertyPrice: Number(form.propertyPrice),
      downPayment: Number(form.downPayment),
      annualInterestRate: Number(form.annualInterestRate),
      amortizationYears: form.amortizationYears,
      paymentSchedule: form.paymentSchedule,
      isFirstTimeHomeBuyer: form.isFirstTimeHomeBuyer,
      isNewConstruction: form.isNewConstruction,
      hasNonTraditionalDownPayment: form.hasNonTraditionalDownPayment,
      isSelfEmployedNonVerifiedIncome: form.isSelfEmployedNonVerifiedIncome,
    });
  }

  return (
    <form className="mortgage-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="propertyPrice">Property price ($)</label>
        <input
          id="propertyPrice"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          required
          value={form.propertyPrice}
          onChange={(e) => setForm((f) => ({ ...f, propertyPrice: e.target.value }))}
        />
      </div>

      <div className="field">
        <label htmlFor="downPayment">Down payment ($)</label>
        <input
          id="downPayment"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          required
          value={form.downPayment}
          onChange={(e) => setForm((f) => ({ ...f, downPayment: e.target.value }))}
        />
      </div>

      <div className="field">
        <label htmlFor="annualInterestRate">Annual interest rate (%)</label>
        <input
          id="annualInterestRate"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="0.01"
          required
          value={form.annualInterestRate}
          onChange={(e) => setForm((f) => ({ ...f, annualInterestRate: e.target.value }))}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="amortizationYears">Amortization period</label>
          <select
            id="amortizationYears"
            value={form.amortizationYears}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                amortizationYears: Number(e.target.value) as AmortizationYears,
              }))
            }
          >
            {AMORTIZATION_YEARS_OPTIONS.map((years) => (
              <option key={years} value={years}>
                {years} years
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="paymentSchedule">Payment schedule</label>
          <select
            id="paymentSchedule"
            value={form.paymentSchedule}
            onChange={(e) =>
              setForm((f) => ({ ...f, paymentSchedule: e.target.value as PaymentSchedule }))
            }
          >
            {PAYMENT_SCHEDULES.map((schedule) => (
              <option key={schedule} value={schedule}>
                {PAYMENT_SCHEDULE_LABELS[schedule]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="eligibility-fields">
        <legend>Buyer Info</legend>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.hasNonTraditionalDownPayment}
            onChange={(e) =>
              setForm((f) => ({ ...f, hasNonTraditionalDownPayment: e.target.checked }))
            }
          />
          Down payment includes borrowed funds and gift from non-immediate family members?
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.isSelfEmployedNonVerifiedIncome}
            onChange={(e) =>
              setForm((f) => ({ ...f, isSelfEmployedNonVerifiedIncome: e.target.checked }))
            }
          />
          Self-Employed without third party verification?
        </label>
      </fieldset>

      <fieldset className="eligibility-fields">
        <legend>Buyer eligibility</legend>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.isFirstTimeHomeBuyer}
            onChange={(e) => setForm((f) => ({ ...f, isFirstTimeHomeBuyer: e.target.checked }))}
          />
          I am a first-time home buyer
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.isNewConstruction}
            onChange={(e) => setForm((f) => ({ ...f, isNewConstruction: e.target.checked }))}
          />
          This is a newly constructed home
        </label>
        <p className="field-hint">
          {showEligibilityFields
            ? "A 30-year amortization on a mortgage with less than 20% down requires one of these to be checked."
            : "Only relevant for a 30-year amortization with less than 20% down."}
        </p>
      </fieldset>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Calculating…" : "Calculate payment"}
      </button>
    </form>
  );
}
