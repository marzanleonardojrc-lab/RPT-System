# Security Specification: RPT Delinquency Tracker

## 1. Data Invariants
- A `Delinquency` record must always reference an existing `Property`.
- Only `admin` role can promote a user to `encoder` or `admin`.
- `AuditLog` records are immutable (no update, no delete).
- `Delinquency` records cannot be deleted, only `VOIDED` (status field).
- `Property` records cannot be deleted.
- Penalties and Interests must be calculated based on the `updatedAt` server timestamp.

## 2. The "Dirty Dozen" Payloads (Deny Test Cases)

1. **Self-Promotion Attack**: Authenticated user tries to update their own `role` to 'admin'.
2. **Property PIN Forgery**: User tries to create a `Property` with a 2KB long PIN.
3. **Ghost Delinquency**: User tries to create a `Delinquency` for a non-existent `propertyId`.
4. **History Erasure**: User tries to `delete` an `AuditLog` entry.
5. **Backdated Interest**: User tries to set `penalty` directly in the payload instead of letting the system (via rules/functions) or just bypassing the intended logic. (Rules should enforce basic schema).
6. **Unauthorized Barangay Access**: (If we had barangay restrictions, but here it's team-wide).
7. **Audit Spoofing**: User A creates an `AuditLog` claiming it was done by User B (`userId` mismatch).
8. **Shadow Field Injection**: User adds `isSystemAdmin: true` to a `Property` doc.
9. **Bulk Export Scraping**: Unauthenticated or unauthorized user tries to `list` entire `delinquencies` collection.
10. **ID Poisoning**: User tries to create a document with ID `../../secrets/config`.
11. **Status Shortcut**: Viewer role tries to change a Delinquency status to `Paid`.
12. **PII Leak**: Viewer role tries to read `User` private data (if we have any).

## 3. Test Runner (Draft)
A `firestore.rules.test.ts` would verify these by attempting operations with different `auth` contexts and expecting `Permission Denied`.
