# RULES.md — every threshold, band, and assumption

Everything below lives in code as plain data/functions in `rules.js`, with zero
UI logic mixed in. This document explains each one in the same order they
appear in that file.

## 1. FOIR caps (Fixed Obligation-to-Income Ratio)

FOIR = (existing EMIs + fixed essential expenses + new EMI) ÷ net monthly income.
We track **two** caps per employment type, because a lender and a financially
responsible borrower should not use the same number:

| Employment type | Lender cap | Safe (borrower) cap | Why · source |
|---|---|---|---|
| Salaried | 50% | 40% | Lender cap: commonly cited retail-lending practice for salaried borrowers in India (typically 40-55% depending on income band). Safe cap set 10pp stricter — my judgement, to leave room for expenses the lender doesn't see. |
| Self-employed | 40% | 32% | Lender cap lower than salaried because income is self-reported/less verifiable. Safe cap stricter still — my judgement — since income can swing month to month. |
| Informal / gig | 30% | 22% | Lowest caps: no documentation, no employer backstop, highest income volatility. My judgement. |

**Key difference between lender and safe FOIR:** the **lender** cap is applied
only against *existing EMIs* (the number a bank checks). The **safe** cap is
applied against *existing EMIs + rent/essential fixed costs* — because a
borrower's real life doesn't stop at what a bank chooses to count. This is
the single biggest reason the two O2 numbers differ.

## 2. Adjustments to the safe cap (each capped, so no one answer swings things wildly)

| Signal | Adjustment | Why |
|---|---|---|
| Emergency savings ≥ 6 months | +4pp | More buffer against income shocks → judgement |
| Emergency savings 3–5 months | +2pp | Partial buffer → judgement |
| Emergency savings < 1 month | −4pp | No cushion → judgement |
| Recent EMI/bill bounce | −10pp | Strongest real-world signal of existing stress → judgement |
| Income stability ≥ 3 yrs (salaried) / ≥ 5 yrs (self-employed/informal) | +2pp / +3pp | Track record reduces uncertainty → judgement |
| Income stability < 1 yr (salaried) / < 2 yrs (other) | −2pp / −3pp | Newer income is less proven → judgement |
| Variable income share ≥ 50% | −3pp | Unpredictable months matter more than the average → judgement |
| Variable income share ≤ 15% | +1pp | Near-fixed income, low risk → judgement |
| Upcoming large expense (6 months) | −3pp | Known future drain on the same income → judgement |

Result is clamped to [0%, 60%] as a sanity bound. If a borrower skips all of
these, the base cap from the table above is used unchanged — this is what
"confidence widens with silence" means in practice: fewer answers → we fall
back to the wider, more conservative baseline rather than guessing.

## 3. Product routing

| Rule | Why |
|---|---|
| Purpose = vehicle → Two-Wheeler Loan | Vehicle loans are secured by the vehicle itself and cheaper than a personal loan for the same purpose. |
| Owns unencumbered property → Loan Against Property | Secured lending is materially cheaper than unsecured, regardless of credit score — the collateral does the work a credit score would otherwise do. Property is checked before gold since LAP typically offers longer tenure and can cover larger amounts. |
| Owns gold (no property) → Gold Loan | Same secured-is-cheaper logic, for borrowers without property. |
| Self-employed + purpose = business, no collateral → Business Loan | Matches the loan to its actual use; unsecured but calibrated for business cash flow. |
| Everything else → Personal Loan (unsecured) | Default / fallback product. |

This is a simplification: real lenders offer many more product variants. We
scoped to the five products that cover the three given personas plus common
adjacent cases, per the brief's explicit note that product breadth isn't scored.

## 4. Interest rate bands (annual %, nominal, before fees)

Bands by product × credit-score tier. Source: **judgement**, informed by
publicly typical ranges Indian lenders publish for each product/segment as of
2025–26 — not pulled from any single lender's live rate card.

- **Score tiers:** Excellent ≥750, Good 700–749, Fair 650–699, Poor <650, **Unknown** = no score on file.
- **"Unknown is never zero" rule in practice:** the Unknown tier is deliberately
  placed *between* Good and Fair for unsecured products (wide band, not
  automatically worst-case) — an unrated borrower isn't assumed to be a bad
  one. For secured products (LAP, Gold), the Unknown tier barely moves the
  band at all, because the collateral — not the score — is doing most of the
  risk-pricing work.

See the `RATE_BANDS` table in `rules.js` for the full 5-product × 5-tier grid.

## 5. Processing fee / APR approximation

| Product | Assumed one-time processing fee | Source |
|---|---|---|
| Personal loan | 2.0% | Judgement — typical published range 1–3% |
| Business loan | 2.0% | Judgement |
| Loan Against Property | 1.0% | Judgement — secured loans typically charge less |
| Gold loan | 0.5% | Judgement |
| Two-wheeler loan | 1.5% | Judgement |

**Simplification we're explicit about:** a true APR requires an IRR-style
amortisation calculation. We approximate it as `nominal rate + (fee % ÷
tenure in years)` — i.e. we spread the one-time fee evenly across the loan's
life and add it to the nominal rate. This is directionally correct (more fee
or shorter tenure → bigger APR gap from the nominal rate) but understates the
true IRR-based APR slightly, especially on short tenures. Documented here
rather than hidden in code.

## 6. EMI math

Standard reducing-balance EMI formula:

```
EMI = P × r × (1+r)ⁿ / ((1+r)ⁿ − 1)
```
where `r` = monthly rate (annual ÷ 12 ÷ 100), `n` = tenure in months. We use
the algebraic inverse of this formula to go from "EMI budget the borrower can
afford" to "maximum loan amount" — this is standard financial math, not a
judgement call.

## 7. Tenure defaults

| Product | Max tenure used | Why |
|---|---|---|
| Personal / Business / Two-wheeler | 5 years | Typical maximum for these unsecured/vehicle products. |
| Loan Against Property | capped at 10 years for our default calculation (product itself allows up to 15) | Judgement — a 15-year default felt overly optimistic for an illustrative "safe" number; a longer tenure is shown as a trade-off, not the default. |
| Gold loan | 3 years | Typical short tenure for gold loans. |

## 8. Verdict logic (O1)

Evaluated in this order — first match wins:

1. **Recent bounce AND existing high-cost debt ≥ ~50% of a rough 3-month income proxy** → `DON'T BORROW`. A recent missed payment combined with heavy existing high-interest debt is treated as a hard stop, regardless of what the raw FOIR math would otherwise allow. Judgement, prioritising borrower safety over maximising the calculated number.
2. **Safe EMI room ≤ 0** → `DON'T BORROW`. No mathematical room left.
3. **Safe EMI room < 85% of the EMI the requested amount would need** → `BORROW LESS`. The 85% threshold is a buffer, not a hard equality check — judgement.
4. Otherwise → `BORROW`.

## 9. Stress test (used in O4)

Two stress scenarios are shown alongside the safe EMI ceiling:
- **Income drop:** recompute safe room assuming income falls 15%. (15% is a
  round, illustrative shock — judgement, not derived from any specific
  historical income-volatility dataset.)
  Rate rise: +2 percentage points added to the shown mid-rate for the stress
  scenario — judgement, a plausible near-term rate-cycle swing.

## 10. What we deliberately left out (honesty about limits)

- No real bureau/CIBIL integration — credit score is self-reported.
- No live lender rate cards — all bands are judgement-based approximations of
  typical published ranges, not scraped or verified against a real lender API.
- APR is an approximation (see §5), not a true IRR calculation.
- Loan product catalogue limited to the five products needed for the three
  personas plus adjacent common cases (personal, business, LAP, gold,
  two-wheeler) — no education loans, agri loans, etc.
- No handling of joint/co-applicant credit scores, only co-applicant income.
- FOIR adjustment weights (§2) are hand-picked and capped, not fitted to any
  dataset — they encode directional judgement ("more savings = safer"), not
  precise magnitudes.
