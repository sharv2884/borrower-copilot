/* ============================================================
   BORROWER COPILOT — RULES ENGINE
   Every threshold here is documented (with source or "judgement")
   in RULES.md. This file has ZERO UI code — only pure functions
   and constant tables, so it can be read/defended on its own.
   ============================================================ */

const Rules = (() => {

  // ----------------------------------------------------------
  // 1. FOIR CAPS (Fixed Obligation to Income Ratio)
  //    = (existing EMIs + rent/essential fixed costs + new EMI) / income
  //    LENDER cap: what a bank typically allows (EMIs only, ignores rent)
  //    SAFE cap: what we recommend the borrower actually live within
  //    (counts rent + essential fixed costs too, and is stricter)
  // ----------------------------------------------------------
  const FOIR_CAPS = {
    salaried:       { lender: 0.50, safe: 0.40 },
    self_employed:  { lender: 0.40, safe: 0.32 }, // stricter: income less certain
    informal:       { lender: 0.30, safe: 0.22 }, // strictest: no documentation, no buffer
  };

  // Adjustments to the SAFE cap based on additional signals (each capped so
  // no single answer can swing things wildly — "confidence widens with silence" rule)
  const SAFE_CAP_ADJUSTMENTS = {
    emergencySavings: (months) => {
      if (months === null || months === undefined) return 0;
      if (months >= 6) return +0.04;
      if (months >= 3) return +0.02;
      if (months < 1) return -0.04;
      return 0;
    },
    recentBounce: (hadBounce) => (hadBounce ? -0.10 : 0),
    incomeStabilityYears: (years, employmentType) => {
      if (years === null || years === undefined) return 0;
      if (employmentType === "salaried") {
        if (years >= 3) return +0.02;
        if (years < 1) return -0.02;
      } else {
        // self-employed / informal: stability matters more, since income is unverified
        if (years >= 5) return +0.03;
        if (years < 2) return -0.03;
      }
      return 0;
    },
    variableIncomeShare: (pct) => {
      // pct = % of income that is unpredictable month-to-month
      if (pct === null || pct === undefined) return 0;
      if (pct >= 50) return -0.03;
      if (pct <= 15) return +0.01;
      return 0;
    },
    upcomingLargeExpense: (hasOne) => (hasOne ? -0.03 : 0),
  };

  // ----------------------------------------------------------
  // 2. PRODUCT ROUTING
  //    Which loan product should this borrower actually be
  //    compared against, given purpose + available collateral?
  // ----------------------------------------------------------
  const PRODUCTS = {
    personal_unsecured: { label: "Personal Loan (unsecured)", maxTenureYears: 5 },
    loan_against_property: { label: "Loan Against Property (secured)", maxTenureYears: 15, maxLTV: 0.60 },
    gold_loan: { label: "Gold Loan (secured)", maxTenureYears: 3, maxLTV: 0.75 },
    business_loan: { label: "Business Loan (unsecured)", maxTenureYears: 5 },
    two_wheeler: { label: "Two-Wheeler Loan (secured by vehicle)", maxTenureYears: 5, maxLTV: 0.85 },
  };

  function routeProduct({ purpose, hasProperty, hasGold, employmentType }) {
    // Rule: if usable collateral exists, ALWAYS surface the secured option
    // alongside the "natural" one, because secured is near-always cheaper.
    if (purpose === "vehicle") return "two_wheeler";
    if (hasProperty) return "loan_against_property";
    if (hasGold) return "gold_loan";
    if (employmentType === "self_employed" && purpose === "business") return "business_loan";
    return "personal_unsecured";
  }

  // ----------------------------------------------------------
  // 3. INTEREST RATE BANDS (annual %, nominal — before fees)
  //    Bands are deliberately WIDE at the edges (unknown score,
  //    unstable income) — "unknown is never zero" rule.
  //    Source: judgement, informed by typical 2025-26 Indian
  //    lender publishing ranges for each product/segment.
  // ----------------------------------------------------------
  const RATE_BANDS = {
    personal_unsecured: {
      excellent:  [10.5, 13.0],  // score >= 750
      good:       [13.0, 16.5],  // score 700-749
      fair:       [16.5, 21.0],  // score 650-699
      poor:       [21.0, 28.0],  // score < 650
      unknown:    [16.0, 24.0],  // no score on file — wide, not automatically "poor"
    },
    business_loan: {
      excellent:  [14.0, 17.0],
      good:       [17.0, 20.0],
      fair:       [20.0, 24.0],
      poor:       [24.0, 30.0],
      unknown:    [18.0, 26.0],
    },
    loan_against_property: {
      // secured — score matters far less than the collateral itself
      excellent:  [9.0, 10.5],
      good:       [9.5, 11.0],
      fair:       [10.0, 11.5],
      poor:       [10.5, 12.5],
      unknown:    [9.5, 11.5], // unrated score does NOT push this band up much — collateral dominates
    },
    gold_loan: {
      excellent:  [9.0, 10.5], good: [9.0, 11.0], fair: [9.5, 11.5], poor: [10.0, 12.0], unknown: [9.5, 11.5],
    },
    two_wheeler: {
      excellent:  [10.5, 12.5], good: [11.5, 13.5], fair: [13.0, 15.5], poor: [15.0, 18.0], unknown: [13.0, 16.0],
    },
  };

  function scoreTier(score) {
    if (score === null || score === undefined) return "unknown";
    if (score >= 750) return "excellent";
    if (score >= 700) return "good";
    if (score >= 650) return "fair";
    return "poor";
  }

  // Processing fee assumption (source: judgement, typical published range)
  const PROCESSING_FEE_PCT = {
    personal_unsecured: 0.02,
    business_loan: 0.02,
    loan_against_property: 0.01,
    gold_loan: 0.005,
    two_wheeler: 0.015,
  };

  // Simplified APR: nominal rate + (one-time fee annualised over the tenure).
  // This is an approximation of true APR (a full amortisation-based APR would
  // need an IRR calc) — documented as a simplification in RULES.md.
  function approximateAPR(nominalRatePct, feePct, tenureYears) {
    const annualisedFee = (feePct * 100) / Math.max(tenureYears, 1);
    return +(nominalRatePct + annualisedFee).toFixed(2);
  }

  // ----------------------------------------------------------
  // 4. EMI MATH
  // ----------------------------------------------------------
  // Forward: principal -> EMI
  function computeEMI(principal, annualRatePct, tenureYears) {
    const r = annualRatePct / 12 / 100;
    const n = tenureYears * 12;
    if (r === 0) return principal / n;
    const emi = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    return emi;
  }

  // Reverse: EMI budget -> max principal
  function computeMaxPrincipal(emiBudget, annualRatePct, tenureYears) {
    const r = annualRatePct / 12 / 100;
    const n = tenureYears * 12;
    if (emiBudget <= 0) return 0;
    if (r === 0) return emiBudget * n;
    const principal = (emiBudget * (Math.pow(1 + r, n) - 1)) / (r * Math.pow(1 + r, n));
    return principal;
  }

  function totalInterest(principal, emi, tenureYears) {
    return emi * tenureYears * 12 - principal;
  }

  // ----------------------------------------------------------
  // 5. VERDICT LOGIC (O1)
  // ----------------------------------------------------------
  function verdict({ safeRoomEmi, requestedEmiEquivalent, recentBounce, existingHighCostDebtRatio }) {
    // Hard stop: recent bounce + already-heavy high-cost debt = don't borrow now,
    // regardless of what the math otherwise allows.
    if (recentBounce && existingHighCostDebtRatio >= 0.5) {
      return {
        verdict: "DONT_BORROW",
        reason: "You missed a payment recently and a large share of your income is already going to high-interest debt. Taking on more debt now is likely to make things worse, not better.",
      };
    }
    if (safeRoomEmi <= 0) {
      return {
        verdict: "DONT_BORROW",
        reason: "Your existing commitments already use up all the room your income safely allows for EMIs. There's no safe room for a new loan right now.",
      };
    }
    if (requestedEmiEquivalent && safeRoomEmi < requestedEmiEquivalent * 0.85) {
      return {
        verdict: "BORROW_LESS",
        reason: "What you're asking for would push your monthly payments past what's safe for your income and existing commitments.",
      };
    }
    return {
      verdict: "BORROW",
      reason: "Based on your income and existing commitments, this loan looks manageable within a safe monthly budget.",
    };
  }

  return {
    FOIR_CAPS, SAFE_CAP_ADJUSTMENTS, PRODUCTS, routeProduct,
    RATE_BANDS, scoreTier, PROCESSING_FEE_PCT, approximateAPR,
    computeEMI, computeMaxPrincipal, totalInterest, verdict,
  };
})();
