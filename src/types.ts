export type UserRole = "Admin" | "User" | "Guest" | "End-User" | "Taxpayer" | "Resident";
export type UserStatus = "Pending" | "Approved" | "Denied";

export interface UserProfile {
  uid: string;
  email: string;
  username?: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  linkedPropertyIds?: string[];
  requiresPasswordReset?: boolean;
  designation?: string;
}

export type PropertyClassification = "LAND" | "BUILDING" | "MACHINERY";

export interface Property {
  id: string;
  pin: string;
  // I. RECORD OF OWNERSHIP
  ownerName: string;
  ownerAddress: string;
  administratorName: string;
  administratorAddress: string;
  effectivityDate: string; // Date of Transfer
  tdNumber: string; // Tax Declaration Number

  // II. TECHNICAL PROPERTY DESCRIPTION
  detailedLocation: string;
  street: string;
  barangay: string;
  municipality: string;
  province: string;
  lotNo: string;
  blkNo: string;
  octTct: string;
  cctCloa: string;

  // III. KIND OF PROPERTY ASSESSED
  classification: PropertyClassification;
  area: string;
  assessedValue: number;

  // IV. REMARKS
  previousTdNo: string;
  previousOwner: string;
  previousAssessedValue: number;
  recordedBy: string;

  // Status/Meta
  isArchived?: boolean;
  archivedAt?: string;
  updatedAt: string;
  createdAt: string;
}

export type DelinquencyStatus = "Pending" | "Delinquent" | "Paid" | "Voided";

export type PaymentDetails = Omit<Payment, 'id' | 'delinquencyId' | 'propertyId' | 'status' | 'voidMetadata'>;

export interface Payment {
  id: string;
  delinquencyId: string;
  propertyId: string;
  taxYear: number;
  assessedValue: number;
  orNumber: string;
  paymentDate: string;
  payerName: string;
  paymentType: "Full" | "Partial" | "Installment";
  amountPaid: number;
  basicPaid: number;
  sefPaid: number;
  penaltyPaid: number;
  recordedBy: string; // Encoder
  approvedBy: string; // Approver
  treasurer?: string;
  deputy?: string;
  status: "Active" | "Voided";
  voidMetadata?: {
    reason: string;
    encoder: string;
    approver: string;
    voidedAt: string;
  };
  recordedAt: string;
}

export interface Delinquency {
  id: string;
  propertyId: string;
  year: number;
  basicTaxDue: number;
  sefTaxDue: number;
  penalty: number; // Current calculated penalty
  interest: number;
  totalDue: number;
  status: DelinquencyStatus;
  totalPaid: number;
  paymentDetails?: PaymentDetails; // Kept for legacy/last payment info
  payments?: Payment[]; // Optional populated payments
  pendingUpdate?: {
    basicTaxDue: number;
    sefTaxDue: number;
    monthsCount: number;
    interest: number;
    totalDue: number;
    reason: string;
    requestedBy: string;
    requestedAt: string;
  };
  voidMetadata?: {
    reason: string;
    encoder: string;
    approver: string;
    voidedAt: string;
  };
  updatedAt: string;
  createdAt: string;
}

export type AuditAction = "CREATE" | "UPDATE" | "VOID" | "DELETE" | "LOGIN" | "EXPORT" | "APPROVE";

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: AuditAction;
  entityId: string;
  entityType: string;
  oldValue?: any;
  newValue?: any;
  timestamp: string;
}
