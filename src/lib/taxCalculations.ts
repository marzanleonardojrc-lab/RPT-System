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

export function calculateTotalDue(basicTaxDue: number, sefTaxDue: number, year: number, currentDate: Date = new Date(), idleSurcharge: number = 0) {
  const combinedBase = basicTaxDue + sefTaxDue + idleSurcharge;
  const penalties = calculatePenalties(combinedBase, year, currentDate);
  
  const totalDue = combinedBase + penalties.interestAmount;
  
  return {
    basicTaxDue,
    sefTaxDue,
    idleSurcharge,
    interest: penalties.interestAmount,
    totalDue,
    monthsCount: penalties.monthsCount,
    interestRate: penalties.interestRate,
    isCapped: penalties.isCapped
  };
}
