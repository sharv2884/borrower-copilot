/* ============================================================
   BORROWER COPILOT — QUESTION FLOW + ORCHESTRATION
   This file decides WHAT to ask and WHEN (adaptive skipping),
   collects answers, then hands them to rules.js to compute
   the four outputs + Negotiation Card. No thresholds live here.
   ============================================================ */

const state = { answers: {}, step: 0 };

// ---- QUESTION DEFINITIONS -----------------------------------
// "must" questions run first, unconditionally (except where the
// branch itself is adaptive, e.g. income question differs by
// employment type). "extra" questions are asked only when they
// will change an output — each has a one-line justification.

const MUST_QUESTIONS = [
  {
    id: "purpose", label: "What is this loan for?", type: "select",
    options: [
      ["personal", "Personal need (wedding, medical, travel, etc.)"],
      ["business", "Business (stock, equipment, working capital)"],
      ["vehicle", "Buying a vehicle"],
      ["home_improvement", "Home improvement / renovation"],
      ["debt_consolidation", "Paying off other debt"],
    ],
  },
  { id: "amountWanted", label: "How much do you want to borrow (₹)?", type: "number" },
  {
    id: "employmentType", label: "How would you describe your income?", type: "select",
    options: [
      ["salaried", "Salaried — fixed monthly salary from an employer"],
      ["self_employed", "Self-employed / business owner"],
      ["informal", "Informal / gig work / daily wage — no fixed employer"],
    ],
  },
  {
    id: "netMonthlyIncome", label: "What is your net (take-home) monthly income (₹)? If it varies, give your typical/average month.",
    type: "number",
  },
  {
    id: "verifiedAnnualIncome",
    label: "What annual income does your ITR / tax filing show (₹)? Enter 0 if you don't file one.",
    type: "number",
    showIf: (a) => a.employmentType === "self_employed",
  },
  { id: "existingEMIs", label: "What do you currently pay every month toward other loan EMIs (₹)? Enter 0 if none.", type: "number" },
  { id: "essentialExpenses", label: "What is your monthly rent + other unavoidable fixed household expense (₹)?", type: "number" },
  { id: "age", label: "What is your age?", type: "number" },
  {
    id: "creditScoreKnown", label: "Do you know your credit score (CIBIL etc.)?", type: "select",
    options: [["yes", "Yes"], ["no", "No / not sure"]],
  },
  { id: "creditScore", label: "What is your credit score?", type: "number", showIf: (a) => a.creditScoreKnown === "yes" },
  {
    id: "hasProperty", label: "Do you own property (house/shop) with no loan against it, that you could offer as security?",
    type: "select", options: [["yes", "Yes"], ["no", "No"]],
  },
  { id: "propertyValue", label: "Roughly what is that property worth (₹)?", type: "number", showIf: (a) => a.hasProperty === "yes" },
  {
    id: "hasGold", label: "Do you own gold you could offer as security?", type: "select",
    options: [["yes", "Yes"], ["no", "No"]], showIf: (a) => a.hasProperty !== "yes",
  },
  { id: "goldValue", label: "Roughly what is that gold worth (₹)?", type: "number", showIf: (a) => a.hasGold === "yes" },
];

const EXTRA_QUESTIONS = [
  {
    id: "incomeStabilityYears",
    label: "How many years have you been in this job / running this business?",
    type: "number",
    why: "Longer stability raises your safe borrowing room and can improve your rate tier; very short history lowers both.",
  },
  {
    id: "variableIncomeSharePct",
    label: "What % of your income is unpredictable month-to-month (varies a lot)?",
    type: "number",
    showIf: (a) => a.employmentType !== "salaried",
    why: "Highly variable income narrows your safe room, since your worst month matters more than your average month.",
  },
  {
    id: "recentBounce",
    label: "Has any EMI or bill payment bounced/failed in the last 6 months?",
    type: "select", options: [["yes", "Yes"], ["no", "No"]],
    why: "A recent bounce is the strongest signal of existing repayment stress and can flip the verdict to 'don't borrow now'.",
  },
  {
    id: "existingHighCostDebt",
    label: "Do you have any existing loans (e.g. app loans, credit card debt) at very high interest (25%+)? If so, what's the total outstanding (₹)?",
    type: "number",
    why: "Existing high-cost debt lowers safe room and factors into whether new borrowing is advisable right now.",
  },
  {
    id: "emergencySavingsMonths",
    label: "If your income stopped today, how many months of expenses do you have saved?",
    type: "number",
    why: "More of a safety cushion allows a slightly higher safe borrowing cap; near-zero savings lowers it.",
  },
  {
    id: "coApplicantIncome",
    label: "Will anyone else (spouse/family) co-apply and add their income? If so, their net monthly income (₹), else 0.",
    type: "number",
    why: "Co-applicant income directly adds to the pool used to calculate your safe borrowing room.",
  },
  {
    id: "upcomingLargeExpense",
    label: "Any large expense coming up in the next 6 months (medical, school fees, etc.)?",
    type: "select", options: [["yes", "Yes"], ["no", "No"]],
    why: "A known upcoming expense reduces the safe room left over for a new EMI.",
  },
  {
    id: "lenderQuotedRate",
    label: "Has a lender already quoted you a rate or offer? If so, enter the % rate (else leave 0).",
    type: "number",
    why: "Used only to compare against your fair band on the Negotiation Card — doesn't change your own numbers.",
  },
];

function visibleExtraQuestions(answers) {
  return EXTRA_QUESTIONS.filter((q) => !q.showIf || q.showIf(answers));
}

function allQuestionsInOrder(answers) {
  const must = MUST_QUESTIONS.filter((q) => !q.showIf || q.showIf(answers));
  const extra = visibleExtraQuestions(answers);
  return [...must, ...extra];
}

// ---- COMPUTE RESULTS ------------------------------------------

function computeResults(a) {
  const employmentType = a.employmentType;
  const income = num(a.netMonthlyIncome) + num(a.coApplicantIncome);
  const existingEMIs = num(a.existingEMIs);
  const essentialExpenses = num(a.essentialExpenses);
  const creditScore = a.creditScoreKnown === "yes" ? num(a.creditScore) : null;

  const caps = Rules.FOIR_CAPS[employmentType];
  let safeCap = caps.safe;
  const lenderCap = caps.lender;

  // apply adjustments (each individually small & capped, per rules.js)
  safeCap += Rules.SAFE_CAP_ADJUSTMENTS.emergencySavings(numOrNull(a.emergencySavingsMonths));
  safeCap += Rules.SAFE_CAP_ADJUSTMENTS.recentBounce(a.recentBounce === "yes");
  safeCap += Rules.SAFE_CAP_ADJUSTMENTS.incomeStabilityYears(numOrNull(a.incomeStabilityYears), employmentType);
  safeCap += Rules.SAFE_CAP_ADJUSTMENTS.variableIncomeShare(numOrNull(a.variableIncomeSharePct));
  safeCap += Rules.SAFE_CAP_ADJUSTMENTS.upcomingLargeExpense(a.upcomingLargeExpense === "yes");
  safeCap = Math.max(0, Math.min(0.60, safeCap)); // sanity clamp

  // Lender view: only counts existing EMIs (not rent)
  const lenderRoomEmi = Math.max(0, lenderCap * income - existingEMIs);
  // Safe view: counts EMIs AND essential fixed expenses
  const safeRoomEmi = Math.max(0, safeCap * income - existingEMIs - essentialExpenses);

  // Product routing
  const hasProperty = a.hasProperty === "yes" && num(a.propertyValue) > 0;
  const hasGold = a.hasGold === "yes" && num(a.goldValue) > 0;
  const productKey = Rules.routeProduct({
    purpose: a.purpose, hasProperty, hasGold, employmentType,
  });
  const product = Rules.PRODUCTS[productKey];
  const tenureYears = product.maxTenureYears >= 10 ? 10 : product.maxTenureYears; // sensible default tenure

  // Rate band
  const tier = Rules.scoreTier(creditScore);
  const rateBand = Rules.RATE_BANDS[productKey][tier];
  const midRate = (rateBand[0] + rateBand[1]) / 2;
  const feePct = Rules.PROCESSING_FEE_PCT[productKey];
  const aprBand = rateBand.map((r) => Rules.approximateAPR(r, feePct, tenureYears));

  // Amounts (O2)
  const lenderMaxPrincipal = Rules.computeMaxPrincipal(lenderRoomEmi, midRate, tenureYears);
  let lenderCollateralCap = Infinity;
  if (productKey === "loan_against_property") lenderCollateralCap = num(a.propertyValue) * Rules.PRODUCTS.loan_against_property.maxLTV;
  if (productKey === "gold_loan") lenderCollateralCap = num(a.goldValue) * Rules.PRODUCTS.gold_loan.maxLTV;
  const lenderMax = Math.min(lenderMaxPrincipal, lenderCollateralCap);

  const safeMaxPrincipal = Rules.computeMaxPrincipal(safeRoomEmi, midRate, tenureYears);

  // Verdict (O1)
  const existingHighCostDebt = num(a.existingHighCostDebt);
  const existingHighCostDebtRatio = income > 0 ? existingHighCostDebt / (income * 3) : 0; // rough proxy
  const requestedEmiEquivalent = Rules.computeEMI(num(a.amountWanted), midRate, tenureYears);
  const verdictResult = Rules.verdict({
    safeRoomEmi, requestedEmiEquivalent,
    recentBounce: a.recentBounce === "yes",
    existingHighCostDebtRatio,
  });

  // EMI ceiling + stress case (O4)
  const stressIncome = income * 0.85; // 15% income drop stress test
  const stressSafeRoomEmi = Math.max(0, safeCap * stressIncome - existingEMIs - essentialExpenses);
  const stressRateUp = midRate + 2; // +2pp rate-rise stress test

  return {
    employmentType, income, existingEMIs, essentialExpenses, creditScore, tier,
    lenderCap, safeCap, lenderRoomEmi, safeRoomEmi,
    productKey, product, tenureYears, rateBand, aprBand, midRate, feePct,
    lenderMax, safeMax: safeMaxPrincipal,
    verdict: verdictResult, requestedAmount: num(a.amountWanted),
    stressSafeRoomEmi, stressRateUp,
    lenderQuotedRate: numOrNull(a.lenderQuotedRate),
  };
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function numOrNull(v) { if (v === undefined || v === "" || v === null) return null; const n = parseFloat(v); return isNaN(n) ? null : n; }
function inr(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
