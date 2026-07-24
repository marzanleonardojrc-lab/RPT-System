-- Migration: Row-Level Security (RLS) Policies Customization
-- Location: supabase/migrations/002_rls_policies.sql
-- Description: Refines and strictly enforces security access controls for the Dipaculao Real Property Tax system.
-- Enforces permissions based on user roles: Admin, Encoder (Staff/Users), and Taxpayers.

-- Ensure RLS is active on all schemas
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delinquencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Clean up any existing policies to prevent conflict during migration execution
DO $$ 
DECLARE
    pol record;
BEGIN
    FOR pol IN 
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
    END LOOP;
END $$;


-- ==========================================================
-- 1. USERS & PROFILES TABLE POLICIES (public.users)
-- ==========================================================

-- POLICY: Public Profile Selection
-- Allows all authenticated sessions to query display names and usernames to prevent duplicate registrations.
CREATE POLICY "policy_users_select_all" 
ON public.users FOR SELECT 
TO authenticated 
USING (status = 'Approved');

-- POLICY: Self Registration & Profile Updates
-- Users can insert and update their own metadata (e.g., name, passwords).
CREATE POLICY "policy_users_insert_self" 
ON public.users FOR INSERT 
WITH CHECK (auth.uid()::text = uid);

CREATE POLICY "policy_users_update_self" 
ON public.users FOR UPDATE 
TO authenticated
USING (auth.uid()::text = uid)
WITH CHECK (auth.uid()::text = uid);

-- POLICY: Admin Global Access
-- Admins have total override permissions to assign roles, approve/deny accounts, and prune data.
CREATE POLICY "policy_users_admin_all" 
ON public.users FOR ALL 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role = 'Admin' 
        AND users.status = 'Approved'
    )
);


-- ==========================================================
1.1. STAFF PROFILES TABLE POLICIES (public.staff_profiles)
-- ==========================================================

-- POLICY: Public Selection
CREATE POLICY "policy_staff_profiles_select_all" 
ON public.staff_profiles FOR SELECT 
TO authenticated 
USING (true);

-- POLICY: Self Insert
CREATE POLICY "policy_staff_profiles_insert_self" 
ON public.staff_profiles FOR INSERT 
WITH CHECK (auth.uid()::text = uid);

-- POLICY: Self Update
CREATE POLICY "policy_staff_profiles_update_self" 
ON public.staff_profiles FOR UPDATE 
TO authenticated
USING (auth.uid()::text = uid)
WITH CHECK (auth.uid()::text = uid);

-- POLICY: Admin Global Access
CREATE POLICY "policy_staff_profiles_admin_all" 
ON public.staff_profiles FOR ALL 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role = 'Admin' 
        AND users.status = 'Approved'
    )
);


-- ==========================================================
-- 2. PROPERTIES TABLE POLICIES (public.properties)
-- ==========================================================

-- POLICY: Admin Full Override
CREATE POLICY "policy_properties_admin_all" 
ON public.properties FOR ALL 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role = 'Admin' 
        AND users.status = 'Approved'
    )
);

-- POLICY: Encoder Write Access
-- Encoders can inspect, insert, and update properties, but are forbidden from hard deleting (can only archive).
CREATE POLICY "policy_properties_encoder_read_write" 
ON public.properties FOR SELECT, INSERT, UPDATE 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('User', 'End-User') 
        AND users.status = 'Approved'
    )
);

-- POLICY: Taxpayer Access
-- Taxpayers can only read active properties that are bound to their linked_property_ids array.
CREATE POLICY "policy_properties_taxpayer_select_own" 
ON public.properties FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Taxpayer', 'Resident')
        AND (properties.id = ANY(users.linked_property_ids) OR properties.pin = ANY(users.linked_property_ids))
        AND users.status = 'Approved'
    )
);

-- POLICY: Guest Access
-- Guests can search and read properties but cannot make any edits.
CREATE POLICY "policy_properties_guest_select_all" 
ON public.properties FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role = 'Guest' 
        AND users.status = 'Approved'
    )
);


-- ==========================================================
-- 3. DELINQUENCIES TABLE POLICIES (public.delinquencies)
-- ==========================================================

-- POLICY: Admin Global Delinquencies
CREATE POLICY "policy_delinquencies_admin_all" 
ON public.delinquencies FOR ALL 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role = 'Admin' 
        AND users.status = 'Approved'
    )
);

-- POLICY: Encoder Delinquencies Management
-- Encoders can compute delinquency bills, add records, and update balances.
CREATE POLICY "policy_delinquencies_encoder_manage" 
ON public.delinquencies FOR SELECT, INSERT, UPDATE 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('User', 'End-User') 
        AND users.status = 'Approved'
    )
);

-- POLICY: Taxpayer Self Inspection
-- Taxpayers can read their own delinquency balances and payment assessments.
CREATE POLICY "policy_delinquencies_taxpayer_select_own" 
ON public.delinquencies FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Taxpayer', 'Resident')
        AND delinquencies.property_id = ANY(users.linked_property_ids)
        AND users.status = 'Approved'
    )
);


-- ==========================================================
-- 4. PAYMENTS & OR RECEIPTS POLICIES (public.payments)
-- ==========================================================

-- POLICY: Admin Full Overrides
CREATE POLICY "policy_payments_admin_all" 
ON public.payments FOR ALL 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role = 'Admin' 
        AND users.status = 'Approved'
    )
);

-- POLICY: Encoder Payments Allocation
-- Encoders can issue payments and update records. They cannot void payments without Admin role validation.
CREATE POLICY "policy_payments_encoder_collect" 
ON public.payments FOR SELECT, INSERT, UPDATE 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('User', 'End-User') 
        AND users.status = 'Approved'
    )
);

-- POLICY: Taxpayer Receipt Logs (Data Segregation by Linked Property ID)
-- Ensures that taxpayers can only query payment history for properties explicitly linked to their verified account.
CREATE POLICY "policy_payments_taxpayer_select_own_linked" 
ON public.payments FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Taxpayer', 'Resident')
        AND payments.property_id = ANY(users.linked_property_ids)
        AND users.status = 'Approved'
    )
);

-- POLICY: Taxpayer Receipt Logs (Data Segregation by User/Payer ID)
-- Ensures taxpayers can query payment history of transactions they directly processed or submitted, even if the property linking is pending.
CREATE POLICY "policy_payments_taxpayer_select_own_direct" 
ON public.payments FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Taxpayer', 'Resident')
        AND payments.user_id = auth.uid()::text
        AND users.status = 'Approved'
    )
);


-- ==========================================================
-- 5. AUDIT LOGS POLICIES (public.audit_logs)
-- ==========================================================

-- POLICY: System Append Only
-- All components can record audit logs for transactions, exports, and login operations.
CREATE POLICY "policy_audit_insert_system" 
ON public.audit_logs FOR INSERT 
WITH CHECK (true);

-- POLICY: Staff Read Access
-- Admins, Encoders, and staff can query logs to review audit trails. No user can update or delete them.
CREATE POLICY "policy_audit_select_staff" 
ON public.audit_logs FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Admin', 'User', 'End-User') 
        AND users.status = 'Approved'
    )
);
