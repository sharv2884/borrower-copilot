# Borrower Copilot

A self-assessment tool that helps a borrower answer four questions before
walking into an Indian lender: should I borrow, how much, at what rate, and
what EMI — plus a one-screen Negotiation Card.

## Run it (under a minute)

No install, no server, no dependencies.

1. Download/clone this folder.
2. Open `index.html` in any browser (double-click it, or right-click → Open with → your browser).

That's it. Everything runs client-side from `rules.js` + `app.js`.

## Files

- **`index.html`** — UI only: renders the question wizard and results screen.
- **`app.js`** — question definitions (must + adaptive optional questions) and
  orchestration: collects answers, calls into `rules.js`, shapes the output.
- **`rules.js`** — every threshold, band, and formula. Zero UI code. This is
  the file to read to understand *what the app believes*, and the one
  documented line-by-line in `RULES.md`.
- **`RULES.md`** — every rule/threshold/band with its value and its source or
  "my judgement."
- **`RUNTHROUGHS.md`** — Priya, Ravi, and Anita run through the app, with
  the questions asked, the four outputs, and their Negotiation Cards.

## Design choices worth flagging

- **Two FOIR caps, not one** (lender vs. safe) is the core idea the whole app
  is built around — see RULES.md for why they're computed differently.
- **Product routing happens before rate-banding.** We decide *what kind* of
  loan a borrower should even be compared against (e.g. secured vs.
  unsecured) before picking a rate — this is what gets Ravi routed to Loan
  Against Property instead of a much pricier unsecured business loan.
- **"Unknown" is a tier of its own**, not the worst tier, for credit score —
  see `RULES.md`.