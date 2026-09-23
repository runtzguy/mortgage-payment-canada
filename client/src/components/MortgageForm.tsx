import { useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  AMORTIZATION_YEARS_OPTIONS,
  cmhcBracketRate,
  CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS,
  CMHC_SELF_EMPLOYED_BRACKETS,
  CMHC_STANDARD_BRACKETS,
  INSURED_DOWN_PAYMENT_THRESHOLD,
  MortgageRequestSchema,
  PAYMENT_SCHEDULES,
  PAYMENT_SCHEDULE_LABELS,
  type AmortizationYears,
  type MortgageRequest,
  type PaymentSchedule,
} from "@benjipays/shared";

/** Digits and at most one decimal point — whatever the user actually typed. */
function toRawAmount(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
}

/**
 * Groups the integer part in thousands for display. A trailing "." and a
 * partial decimal are left alone so the field stays editable mid-typing.
 */
function formatAmount(raw: string): string {
  if (raw === "") {
    return "";
  }
  const [wholeRaw, fraction] = raw.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return raw.includes(".") ? `${grouped}.${fraction ?? ""}` : grouped;
}

/**
 * Index just past the nth character that survives formatting, so the caret
 * stays put as commas appear. Counts the decimal point as well as digits —
 * counting digits alone parks the caret before a just-typed ".", which sends
 * the next keystroke to the wrong side of it.
 */
function caretAfterRawLength(value: string, rawLength: number): number {
  if (rawLength <= 0) {
    return 0;
  }
  let seen = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (/[\d.]/.test(value[i])) {
      seen += 1;
      if (seen === rawLength) {
        return i + 1;
      }
    }
  }
  return value.length;
}

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

type FieldErrors = Partial<Record<keyof MortgageRequest, string>>;

export interface ServerError {
  message: string;
  field?: string;
}

interface MortgageFormProps {
  onSubmit: (request: MortgageRequest) => void;
  isSubmitting: boolean;
  /** A typed error from the last request, so the offending input can be marked. */
  serverError?: ServerError | null;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  );
}

export function MortgageForm({ onSubmit, isSubmitting, serverError }: MortgageFormProps) {
  const [form, setForm] = useState<FormState>(initialState);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  /** Set by an amount field's onChange, consumed once the re-render commits. */
  const pendingCaret = useRef<{ input: HTMLInputElement; rawLength: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) {
      return;
    }
    pendingCaret.current = null;
    const position = caretAfterRawLength(pending.input.value, pending.rawLength);
    pending.input.setSelectionRange(position, position);
  });

  const propertyPrice = Number(toRawAmount(form.propertyPrice));
  const downPayment = Number(toRawAmount(form.downPayment));

  const isInsuredCandidate =
    form.propertyPrice !== "" &&
    form.downPayment !== "" &&
    downPayment < INSURED_DOWN_PAYMENT_THRESHOLD * propertyPrice;
  const eligibilityRequired = isInsuredCandidate && form.amortizationYears === 30;

  // Whether each flag actually moves the premium at this down payment, read
  // off the same tables the server prices with. Non-traditional sources only
  // differ below 10% down, so at 10%+ the checkbox is correctly inert — say so
  // rather than leaving the user to wonder whether it is broken.
  const downPaymentPercent = propertyPrice > 0 ? downPayment / propertyPrice : 0;
  const standardRate = cmhcBracketRate(CMHC_STANDARD_BRACKETS, downPaymentPercent);
  const nonTraditionalChangesPremium =
    isInsuredCandidate &&
    cmhcBracketRate(CMHC_NON_TRADITIONAL_DOWN_PAYMENT_BRACKETS, downPaymentPercent) !==
      standardRate;
  const selfEmployedChangesPremium =
    isInsuredCandidate &&
    cmhcBracketRate(CMHC_SELF_EMPLOYED_BRACKETS, downPaymentPercent) !== standardRate;

  /** Reformats as the user types, keeping the caret beside the same digit. */
  function handleAmountChange(field: "propertyPrice" | "downPayment") {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const rawBeforeCaret = toRawAmount(input.value.slice(0, input.selectionStart ?? 0));
      const formatted = formatAmount(toRawAmount(input.value));
      pendingCaret.current = { input, rawLength: rawBeforeCaret.length };
      setForm((f) => ({ ...f, [field]: formatted }));
    };
  }

  /** Client-side error first, then the server's, so the newest feedback wins. */
  function errorFor(field: keyof MortgageRequest): string | undefined {
    return clientErrors[field] ?? (serverError?.field === field ? serverError.message : undefined);
  }

  function fieldProps(field: keyof MortgageRequest) {
    const message = errorFor(field);
    return {
      "aria-invalid": message ? true : undefined,
      "aria-describedby": message ? `${field}-error` : undefined,
    } as const;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // The same schema the API validates with, so rule violations (a down
    // payment above the price, say) are caught without a round trip.
    const parsed = MortgageRequestSchema.safeParse({
      propertyPrice,
      downPayment,
      annualInterestRate: Number(form.annualInterestRate),
      amortizationYears: form.amortizationYears,
      paymentSchedule: form.paymentSchedule,
      isFirstTimeHomeBuyer: form.isFirstTimeHomeBuyer,
      isNewConstruction: form.isNewConstruction,
      hasNonTraditionalDownPayment: form.hasNonTraditionalDownPayment,
      isSelfEmployedNonVerifiedIncome: form.isSelfEmployedNonVerifiedIncome,
    });

    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof MortgageRequest | undefined;
        if (key && !next[key]) {
          next[key] = issue.message;
        }
      }
      setClientErrors(next);
      return;
    }

    setClientErrors({});
    onSubmit(parsed.data);
  }

  return (
    <form className="mortgage-form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="propertyPrice">Property price ($)</label>
        <input
          id="propertyPrice"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          value={form.propertyPrice}
          onChange={handleAmountChange("propertyPrice")}
          {...fieldProps("propertyPrice")}
        />
        <FieldError id="propertyPrice-error" message={errorFor("propertyPrice")} />
      </div>

      <div className="field">
        <label htmlFor="downPayment">Down payment ($)</label>
        <input
          id="downPayment"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          value={form.downPayment}
          onChange={handleAmountChange("downPayment")}
          {...fieldProps("downPayment")}
        />
        <FieldError id="downPayment-error" message={errorFor("downPayment")} />
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
          {...fieldProps("annualInterestRate")}
        />
        <FieldError id="annualInterestRate-error" message={errorFor("annualInterestRate")} />
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
            {...fieldProps("amortizationYears")}
          >
            {AMORTIZATION_YEARS_OPTIONS.map((years) => (
              <option key={years} value={years}>
                {years} years
              </option>
            ))}
          </select>
          <FieldError id="amortizationYears-error" message={errorFor("amortizationYears")} />
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
        <p className="field-hint">
          {!isInsuredCandidate
            ? "Only affects the CMHC premium when the down payment is under 20%."
            : nonTraditionalChangesPremium
              ? "Raises the CMHC premium rate for this down payment."
              : "At 10% or more down, borrowed or gifted funds are priced the same as a traditional down payment — this only raises the premium below 10%."}
        </p>
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
        <p className="field-hint">
          {!isInsuredCandidate
            ? "Only affects the CMHC premium when the down payment is under 20%."
            : selfEmployedChangesPremium
              ? "Raises the CMHC premium rate, and requires at least 10% down."
              : "Requires at least 10% down."}
        </p>
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
          {eligibilityRequired
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
