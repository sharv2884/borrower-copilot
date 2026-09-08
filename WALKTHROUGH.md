# Walkthrough

## What the app does, in one pass (using Ravi as the example)

Ravi opens the app and answers questions about his income, existing loans,
and what he owns. He's self-employed with no formal credit score, but owns
his shop outright.

- **The app skips questions that don't apply to him** — e.g. once he says he
  owns property, it never asks about gold, since one qualifying collateral
  is enough to route him.
- **O1 (verdict):** "Borrow less" — the math supports a large loan, but not
  the full ₹15L he asked for, purely on the income side.
- **O2 (amount):** A lender might sanction up to ₹23,12,224 based on his
  property value; his *safe* number is lower, ₹9,11,550 — calculated only
  from his verifiable income (his ITR income + his wife's income), not his
  harder-to-verify cash income.
- **O3 (rate):** Because he has no credit score, a plain personal loan would
  price him in a wide, cautious band. Instead, the app notices he owns
  unencumbered property and routes him to a **Loan Against Property**
  instead — a secured product where the collateral, not his missing score,
  does most of the risk pricing. That drops his fair rate to 9.5%–11.5%,
  instead of what would likely be 16%+ on an unsecured product.
- **O4 (EMI):** A ₹12,300/month ceiling, with a stress test showing it would
  still hold at ₹8,205/month even if his income dropped 15% and rates rose
  2 points — meaning he has real cushion, unlike Priya's case (see
  RUNTHROUGHS.md), where the same stress test wipes her ceiling to ₹0.
- Everything above collapses into one **Negotiation Card** he can show a
  bank employee, so if a lender quotes him a worse rate on an unsecured
  product, he has a specific, reasoned number to push back with.

The whole engine runs on one idea: **FOIR** — the % of income already
committed to fixed payments. A lender's cap only counts existing EMIs; the
app's "safe" cap also counts rent/essential expenses, which is why the
lender number and the safe number are usually different, sometimes very
different (see Priya in RUNTHROUGHS.md, where they differ by 6x).

## What I'd build next

1. **Accept income as a range, not a fixed number.** Two of the three given
   personas (Ravi, Anita) only gave income *ranges* in their bios — I had to
   pick a midpoint and document it as an assumption. A real user has the
   same problem. Letting someone enter "₹40k–80k" and having the app widen
   its own confidence band accordingly (rather than silently collapsing it
   to one number) would make the "confidence widens with silence" principle
   apply to income itself, not just to which questions get answered.
