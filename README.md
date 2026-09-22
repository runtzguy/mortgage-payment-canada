# Mortgage Payment Calculator

A React client that calculates mortgage payments via a Node/Express REST API, using Canadian
mortgage rules: semi-annual compounding, a tiered minimum down payment, and CMHC mortgage
default insurance.

## Structure

```
shared/   Types, zod schema, and constants shared by the client and server
server/   Express REST API (POST /api/mortgage/payment)
client/   React + Vite single-page app
```

See [`/Users/victorliu/.claude/plans/i-want-to-build-woolly-jellyfish.md`](/Users/victorliu/.claude/plans/i-want-to-build-woolly-jellyfish.md)
for the full design rationale (compounding, minimum down payment tiers, CMHC premium table).

## Requirements

- Node.js 20+
- npm 10+

## Getting started

```bash
npm install
npm run dev
```

This starts the API on `http://localhost:3000` and the Vite dev server (typically
`http://localhost:5173`), with `/api` requests from the client proxied to the API. Open the
Vite URL in your browser.

## Testing

```bash
npm test         # unit + integration tests for both server and client
npm run typecheck
```

## Production build

```bash
npm run build
npm start
```

`npm start` runs the built server on `http://localhost:3000` (or `$PORT`), which also serves
the built client and falls back to `index.html` for client-side routes.

## API

### `POST /api/mortgage/payment`

Request body:

```json
{
  "propertyPrice": 500000,
  "downPayment": 50000,
  "annualInterestRate": 5,
  "amortizationYears": 25,
  "paymentSchedule": "monthly",
  "isFirstTimeHomeBuyer": false,
  "isNewConstruction": false
}
```

- `amortizationYears`: one of `5, 10, 15, 20, 25, 30`.
- `paymentSchedule`: one of `"monthly"`, `"biweekly"`, `"accelerated-biweekly"`.
- `annualInterestRate`: a percentage, e.g. `5` means 5%.
- `isFirstTimeHomeBuyer` / `isNewConstruction`: optional, default `false`. Only checked when the
  mortgage is insured (down payment under 20%) and `amortizationYears` is 30.

200 response:

```json
{
  "payment": 2698.36,
  "paymentSchedule": "monthly",
  "paymentsPerYear": 12,
  "numberOfPayments": 300,
  "minimumDownPayment": 25000,
  "principal": 450000,
  "isInsured": true,
  "cmhcPremiumRate": 0.031,
  "cmhcPremium": 13950,
  "totalLoanAmount": 463950
}
```

400 response:

```json
{
  "error": {
    "code": "DOWN_PAYMENT_TOO_LOW",
    "message": "Down payment is not enough. Minimum required for a $500,000 property is $25,000.00.",
    "field": "downPayment"
  }
}
```

`error.code` is one of `DOWN_PAYMENT_TOO_LOW` or `INVALID_INPUT` (schema validation failures,
or a 30-year amortization requested on an insured mortgage without an eligible buyer).

### Rules encoded in the calculation

- **Compounding:** Canadian semi-annual — the periodic rate is derived from the annual rate via
  `(1 + r/2)^(2/k) − 1`, not a simple `r / k`.
- **Minimum down payment:** 5% of the first $500k, plus 10% of the amount between $500k and
  $1.5M, or 20% of the price at $1.5M and above.
- **CMHC premium** (added to the loan amount before calculating the payment), when down payment
  is under 20%:

  | Down payment | Premium rate |
  | --- | --- |
  | 5% – 9.99% | 4.00% |
  | 10% – 14.99% | 3.10% |
  | 15% – 19.99% | 2.80% |
  | 20% or more | 0% (uninsured) |

  This is the standard CMHC schedule for a traditional down payment with verified income; it
  does not cover non-traditional down payment sources or self-employed/non-verified income.
- **30-year amortization** on an insured mortgage additionally requires the buyer to be a
  first-time home buyer or to be purchasing a newly constructed home, and adds a 0.20 percentage
  point surcharge to the premium rate.
