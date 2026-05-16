import { differenceInMonths, startOfYear, startOfMonth } from "date-fns";

// R.A. 7160 Constants for Municipalities (Dipaculao)
export const BASIC_TAX_RATE = 0.01; // 1% for municipalities
export const SEF_TAX_RATE = 0.01;   // 1% fixed SEF levy
export const IDLE_LAND_RATE = 0.05; // 5% optional/additional surcharge

/**
 * Calculates interest for real property tax delinquency.
 * Interest is 2% per month based on the unpaid primary tax.
 * Maximum interest is 72% (up to 36 months).
 * Penalties for the taxable year start accruing on January 1 of the following year.
 */
export function calculatePenalties(baseTax: number, year: number, currentDate: Date = new Date()) {
  // Penalty starts accruing on Jan 1 of the tax year
  const penaltyStartDate = startOfYear(new Date(year, 0, 1));
  
  // Calculate months from penalty start date to current start of month
  const currentMonthStart = startOfMonth(currentDate);
  
  // differenceInMonths returns the number of full months
  const totalMonths = Math.max(0, differenceInMonths(currentMonthStart, penaltyStartDate) + 1);
  
  // Cap at 36 months (72%) according to Sec. 255 of R.A. 7160
  const applicableMonths = Math.min(36, totalMonths);
  const interestRate = applicableMonths * 0.02;
  const interestAmount = baseTax * interestRate;
  
  return {
    interestAmount,
    interestRate,
    monthsCount: totalMonths,
    isCapped: totalMonths >= 36
  };
}

export function calculateTotalDue(
  basicTaxDue: number, 
  sefTaxDue: number, 
  year: number, 
  currentDate: Date = new Date(), 
  idleSurcharge: number = 0,
  paymentMode: "Full" | "Installment" = "Full",
  selectedQuarters: string[] = [],
  isAdvance: boolean = false
) {
  let combinedBase = basicTaxDue + sefTaxDue + idleSurcharge;
  let interest = 0;
  let discount = 0;
  let multiplier = 1.0;
  let balanceAmount = 0;

  if (paymentMode === "Installment" && selectedQuarters.length > 0) {
    const qLevels = [
      { name: "1st Qtr", factor: 0.25, deadline: new Date(year, 2, 31) }, // March 31
      { name: "2nd Qtr", factor: 0.25, deadline: new Date(year, 5, 30) }, // June 30
      { name: "3rd Qtr", factor: 0.25, deadline: new Date(year, 8, 30) }, // Sept 30
      { name: "4th Qtr", factor: 0.25, deadline: new Date(year, 11, 31) } // Dec 31
    ];

    let totalB = 0;
    let totalS = 0;
    let totalI = 0;
    let cumMultiplier = 0;

    qLevels.forEach(q => {
      if (selectedQuarters.includes(q.name)) {
        const qBase = (basicTaxDue + sefTaxDue) * q.factor;
        let qInt = 0;
        if (currentDate > q.deadline) {
          const p = calculatePenalties(qBase, year, currentDate);
          qInt = p.interestAmount;
        }
        totalB += basicTaxDue * q.factor;
        totalS += sefTaxDue * q.factor;
        totalI += qInt;
        cumMultiplier += q.factor;
      }
    });

    multiplier = cumMultiplier;
    combinedBase = totalB + totalS + idleSurcharge;
    interest = totalI;
    balanceAmount = (basicTaxDue + sefTaxDue) * (1 - multiplier);
    discount = 0; // Installment mode has no discounts

  } else {
    // Full Payment Logic
    const penalties = calculatePenalties(combinedBase, year, currentDate);
    interest = penalties.interestAmount;
    
    // Advance Payment (Rule 1): 20% discount if paying for a future year
    const currentYear = currentDate.getFullYear();
    if (year > currentYear) {
      discount = combinedBase * 0.20;
      interest = 0;
    } 
    // Prompt Payment (Rule 2): 10% discount if paying for the current year within Q1 (Jan 1 - Mar 31)
    else if (year === currentYear) {
      const month = currentDate.getMonth(); // 0 is January, 2 is March
      if (month >= 0 && month <= 2) {
        discount = combinedBase * 0.10;
        interest = 0;
      }
    }
  }

  const penalties = calculatePenalties(combinedBase, year, currentDate);
  const totalDue = combinedBase + interest - discount;
  
  return {
    basicTaxDue: paymentMode === "Installment" ? (basicTaxDue * multiplier) : basicTaxDue,
    sefTaxDue: paymentMode === "Installment" ? (sefTaxDue * multiplier) : sefTaxDue,
    idleSurcharge,
    interest,
    discount,
    totalDue,
    balanceAmount,
    multiplier,
    monthsCount: penalties.monthsCount,
    interestRate: penalties.interestRate,
    isCapped: penalties.isCapped
  };
}

export interface GroupedDelinquency {
  type: 'single' | 'group';
  ids: string[];
  years: number[];
  yearDisplay: string;
  totalBasic: number;
  totalSef: number;
  totalInterest: number;
  totalDiscount: number;
  totalDue: number;
  records: any[];
  startYear?: number;
  endYear?: number;
  assessedValue: number;
  balanceAmount?: number;
  isInstallment?: boolean;
  quarterLabel?: string;
}

/**
 * Groups delinquencies according to the 72% Penalty Aggregation Rule.
 * Aggregates older delinquent years (maxed penalty + same base tax) and keeps recent years itemized.
 */
export function groupDelinquenciesByPenaltyRule(
  delinquencies: any[], 
  assessedValue: number,
  currentDate: Date = new Date(),
  paymentMode: "Full" | "Installment" = "Full",
  selectedQuarters: string[] = [],
  isAdvance: boolean = false,
  existingYears: number[] = []
): GroupedDelinquency[] {
  const recentYears = [2023, 2024, 2025, 2026];
  const sorted = [...delinquencies].sort((a, b) => a.year - b.year);
  const result: GroupedDelinquency[] = [];
  let currentGroup: any = null;

  sorted.forEach(d => {
    const isPaid = d.status === 'Paid';

    if (paymentMode === "Installment" && selectedQuarters.length > 0 && d.year === currentDate.getFullYear()) {
      // In Installment mode for current year, split into actual rows for each selected quarter
      selectedQuarters.forEach(q => {
        const calc = calculateTotalDue(d.basicTaxDue, d.sefTaxDue, d.year, currentDate, 0, "Installment", [q], isAdvance);
        const itemTotalDue = isPaid ? (d.totalPaid || calc.totalDue) : calc.totalDue;
        const itemInterest = isPaid ? (d.penaltyPaid || d.interest || calc.interest) : calc.interest;
        const itemDiscount = isPaid ? (d.discountPaid || calc.discount) : calc.discount;

        result.push({
          type: 'single',
          ids: [d.id],
          years: [d.year],
          yearDisplay: `${d.year} (${q})`,
          quarterLabel: q,
          isInstallment: true,
          totalBasic: calc.basicTaxDue,
          totalSef: calc.sefTaxDue,
          totalInterest: itemInterest,
          totalDiscount: itemDiscount,
          totalDue: itemTotalDue,
          balanceAmount: calc.balanceAmount,
          records: [d],
          assessedValue: assessedValue
        });
      });
      return;
    }

    const calc = calculateTotalDue(d.basicTaxDue, d.sefTaxDue, d.year, currentDate, 0, paymentMode, selectedQuarters, isAdvance);
    const itemTotalDue = isPaid ? (d.totalPaid || calc.totalDue) : calc.totalDue;
    const itemInterest = isPaid ? (d.penaltyPaid || d.interest || calc.interest) : calc.interest;
    const itemDiscount = isPaid ? (d.discountPaid || calc.discount) : calc.discount;

    const isRecent = recentYears.includes(d.year);
    const canGroup = calc.isCapped && !isRecent && paymentMode === "Full"; // Only group in Full mode

    if (!canGroup) {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push({
        type: 'single',
        ids: [d.id],
        years: [d.year],
        yearDisplay: d.year.toString(),
        totalBasic: calc.basicTaxDue,
        totalSef: calc.sefTaxDue,
        totalInterest: itemInterest,
        totalDiscount: itemDiscount,
        totalDue: itemTotalDue,
        balanceAmount: calc.balanceAmount,
        records: [d],
        assessedValue: assessedValue
      });
    } else {
      // Logic for grouping older capped years with same base amounts
      if (currentGroup && 
          currentGroup.basicPerYear === d.basicTaxDue && 
          currentGroup.sefPerYear === d.sefTaxDue) {
        currentGroup.endYear = d.year;
        currentGroup.ids.push(d.id);
        currentGroup.years.push(d.year);
        currentGroup.yearDisplay = `${currentGroup.startYear} – ${d.year}`;
        currentGroup.totalBasic += calc.basicTaxDue;
        currentGroup.totalSef += calc.sefTaxDue;
        currentGroup.totalInterest += itemInterest;
        currentGroup.totalDiscount += itemDiscount;
        currentGroup.totalDue += itemTotalDue;
        currentGroup.balanceAmount += calc.balanceAmount;
        currentGroup.records.push(d);
        currentGroup.assessedValue += assessedValue;
      } else {
        if (currentGroup) result.push(currentGroup);
        currentGroup = {
          type: 'group',
          startYear: d.year,
          endYear: d.year,
          basicPerYear: d.basicTaxDue,
          sefPerYear: d.sefTaxDue,
          ids: [d.id],
          years: [d.year],
          yearDisplay: d.year.toString(),
          totalBasic: calc.basicTaxDue,
          totalSef: calc.sefTaxDue,
          totalInterest: itemInterest,
          totalDiscount: itemDiscount,
          totalDue: itemTotalDue,
          balanceAmount: calc.balanceAmount,
          records: [d],
          assessedValue: assessedValue
        };
      }
    }
  });

  if (currentGroup) result.push(currentGroup);

  // Advance Payment: Add virtual record for the following year
  if (isAdvance) {
    const nextYear = currentDate.getFullYear() + 1;
    // Avoid double adding if somehow already exists (in current set or in system records)
    if (!result.some(r => r.years.includes(nextYear)) && !existingYears.includes(nextYear)) {
      const basicDue = assessedValue * BASIC_TAX_RATE;
      const sefDue = assessedValue * SEF_TAX_RATE;
      const calc = calculateTotalDue(basicDue, sefDue, nextYear, currentDate, 0, paymentMode, selectedQuarters, true);
      
      result.push({
        type: 'single',
        ids: [`advance-${nextYear}`],
        years: [nextYear],
        yearDisplay: nextYear.toString(),
        totalBasic: calc.basicTaxDue,
        totalSef: calc.sefTaxDue,
        totalInterest: calc.interest,
        totalDiscount: calc.discount,
        totalDue: calc.totalDue,
        balanceAmount: calc.balanceAmount,
        records: [{
           id: `advance-${nextYear}`,
           year: nextYear,
           basicTaxDue: basicDue,
           sefTaxDue: sefDue,
           status: 'Active',
           isAdvanceVirtual: true
        }],
        assessedValue: assessedValue
      });
    }
  }

  return result;
}
