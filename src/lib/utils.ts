import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "percent",
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(date: any) {
  if (!date) return "N/A";
  try {
    const d = date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return "N/A";
    return new Intl.DateTimeFormat("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "N/A";
  }
}

export function formatDateFull(date: any) {
  if (!date) return "N/A";
  try {
    const d = date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return "N/A";
    return new Intl.DateTimeFormat("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return "N/A";
  }
}

export function toISODateSafe(date: any) {
  if (!date) return "N_A";
  try {
    const d = date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return "N_A";
    return d.toISOString().split('T')[0].replace(/-/g, '_');
  } catch {
    return "INVALID_DATE";
  }
}

const oklchToRgb = (L: number, C: number, H: number, alpha: number = 1): string => {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b_rgb = -0.0041960863 * l - 0.7034186147 * m + 1.7076210010 * s;

  const toSRGB = (val: number) => {
    return val <= 0.0031308 
      ? 12.92 * val 
      : 1.055 * Math.pow(val, 1 / 2.4) - 0.055;
  };

  const R = toSRGB(r);
  const G = toSRGB(g);
  const B = toSRGB(b_rgb);

  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val * 255)));
  
  const ri = clamp(R);
  const gi = clamp(G);
  const bi = clamp(B);

  if (alpha === 1) {
    return `rgb(${ri}, ${gi}, ${bi})`;
  } else {
    return `rgba(${ri}, ${gi}, ${bi}, ${alpha})`;
  }
};

const parseAndConvertOklch = (colorStr: string): string => {
  if (!colorStr.includes("oklch")) return colorStr;
  
  const inner = colorStr.replace(/oklch\s*\((.*)\)/i, "$1").trim();
  if (!inner || inner === colorStr) return colorStr;

  const tokens = inner.split(/[\s,]+/);
  const cleanTokens = tokens.filter(t => t !== "" && t !== "/");
  
  if (cleanTokens.length >= 3) {
    const lStr = cleanTokens[0] === "none" ? "0" : cleanTokens[0];
    const cStr = cleanTokens[1] === "none" ? "0" : cleanTokens[1];
    const hStr = cleanTokens[2] === "none" ? "0" : cleanTokens[2];
    
    const L = lStr.endsWith("%") ? parseFloat(lStr) / 100 : parseFloat(lStr);
    const C = cStr.endsWith("%") ? parseFloat(cStr) / 100 : parseFloat(cStr);
    
    let hStrClean = hStr;
    let hUnitMultiplier = 1;
    if (hStr.endsWith("deg")) {
      hStrClean = hStr.slice(0, -3);
    } else if (hStr.endsWith("rad")) {
      hStrClean = hStr.slice(0, -3);
      hUnitMultiplier = 180 / Math.PI;
    } else if (hStr.endsWith("turn")) {
      hStrClean = hStr.slice(0, -4);
      hUnitMultiplier = 360;
    } else if (hStr.endsWith("grad")) {
      hStrClean = hStr.slice(0, -4);
      hUnitMultiplier = 360 / 400;
    }
    const H = parseFloat(hStrClean) * hUnitMultiplier;

    let alpha = 1;
    if (cleanTokens.length >= 4) {
      const aVal = cleanTokens[3] === "none" ? "1" : cleanTokens[3];
      if (aVal.endsWith("%")) {
        alpha = parseFloat(aVal) / 100;
      } else {
        alpha = parseFloat(aVal);
      }
    }
    
    if (!isNaN(L) && !isNaN(C) && !isNaN(H)) {
      return oklchToRgb(L, C, H, alpha);
    }
  }
  return colorStr;
};

const oklabToRgb = (L: number, a: number, b: number, alpha: number = 1): string => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b_rgb = -0.0041960863 * l - 0.7034186147 * m + 1.7076210010 * s;

  const toSRGB = (val: number) => {
    return val <= 0.0031308 
      ? 12.92 * val 
      : 1.055 * Math.pow(val, 1 / 2.4) - 0.055;
  };

  const R = toSRGB(r);
  const G = toSRGB(g);
  const B = toSRGB(b_rgb);

  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val * 255)));
  
  const ri = clamp(R);
  const gi = clamp(G);
  const bi = clamp(B);

  if (alpha === 1) {
    return `rgb(${ri}, ${gi}, ${bi})`;
  } else {
    return `rgba(${ri}, ${gi}, ${bi}, ${alpha})`;
  }
};

const parseAndConvertOklab = (colorStr: string): string => {
  if (!colorStr.includes("oklab")) return colorStr;
  
  const inner = colorStr.replace(/oklab\s*\((.*)\)/i, "$1").trim();
  if (!inner || inner === colorStr) return colorStr;

  const tokens = inner.split(/[\s,]+/);
  const cleanTokens = tokens.filter(t => t !== "" && t !== "/");
  
  if (cleanTokens.length >= 3) {
    const lStr = cleanTokens[0] === "none" ? "0" : cleanTokens[0];
    const aStr = cleanTokens[1] === "none" ? "0" : cleanTokens[1];
    const bStr = cleanTokens[2] === "none" ? "0" : cleanTokens[2];
    
    const L = lStr.endsWith("%") ? parseFloat(lStr) / 100 : parseFloat(lStr);
    const aVal = aStr.endsWith("%") ? parseFloat(aStr) / 100 : parseFloat(aStr);
    const bVal = bStr.endsWith("%") ? parseFloat(bStr) / 100 : parseFloat(bStr);

    let alpha = 1;
    if (cleanTokens.length >= 4) {
      const a_alpha_val = cleanTokens[3] === "none" ? "1" : cleanTokens[3];
      if (a_alpha_val.endsWith("%")) {
        alpha = parseFloat(a_alpha_val) / 100;
      } else {
        alpha = parseFloat(a_alpha_val);
      }
    }
    
    if (!isNaN(L) && !isNaN(aVal) && !isNaN(bVal)) {
      return oklabToRgb(L, aVal, bVal, alpha);
    }
  }
  return colorStr;
};

export const resolveModernColors = (styleValue: string): string => {
  if (typeof styleValue !== "string") {
    return styleValue;
  }
  
  let result = styleValue;
  if (result.includes("oklch")) {
    result = result.replace(/oklch\s*\([^)]+\)/gi, (match) => {
      try {
        return parseAndConvertOklch(match);
      } catch (e) {
        console.warn("Failed to parse/convert oklch color:", match, e);
        return match;
      }
    });
  }
  
  if (result.includes("oklab")) {
    result = result.replace(/oklab\s*\([^)]+\)/gi, (match) => {
      try {
        return parseAndConvertOklab(match);
      } catch (e) {
        console.warn("Failed to parse/convert oklab color:", match, e);
        return match;
      }
    });
  }
  
  return result;
};