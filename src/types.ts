export type UserRole = "Admin" | "End-User";
export type UserStatus = "Pending" | "Approved" | "Denied";

export interface UserProfile {
  uid: string;
  email: string;
  username?: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export type PropertyType = "Residential" | "Commercial" | "Industrial" | "Agricultural" | "Special";

export interface Property {
  id: string;
  pin: string;
  ownerName: string;
  assessedValue: number;
  barangay: string;
  propertyType: PropertyType;
  taxDeclaration?: string;
  isIdle?: boolean;
  isArchived?: boolean;
  archivedAt?: string;
  updatedAt: string;
  createdAt: string;
}

export type DelinquencyStatus = "Pending" | "Delinquent" | "Paid" | "Voided";

export interface PaymentDetails {
  orNumber: string;
  paymentDate: string;
  payerName: string;
  paymentType: "Full" | "Partial" | "Installment";
  amountPaid: number;
  recordedBy: string;
  recordedAt: string;
}

export interface Delinquency {
  id: string;
  propertyId: string;
  year: number;
  basicTaxDue: number;
  sefTaxDue: number;
  penalty: number;
  interest: number;
  totalDue: number;
  status: DelinquencyStatus;
  paymentDetails?: PaymentDetails;
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
