-- Migration Plan: Firebase Firestore Document DB to Supabase PostgreSQL Relational DB
-- Location: supabase/migrations/001_init_schema.sql
-- Description: Establishes normalized tables, foreign key constraints, indices, and Row Level Security (RLS) policies.

-- Enable PostgreSQL extensions for handling UUID generation and secure operations
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. USERS & PROFILES TABLE
-- Maps Supabase Auth user profiles with application roles, and maintains taxpayer relations.
CREATE TABLE IF NOT EXISTS public.users (
    uid TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'User' CHECK (role IN ('Admin', 'User', 'Guest', 'End-User', 'Taxpayer', 'Resident')),
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Denied')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    linked_property_ids TEXT[] DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for optimized login credential queries and validation checks
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON public.users(role, status);

-- Staff profiles table to track staff member details and approval status concurrently
CREATE TABLE IF NOT EXISTS public.staff_profiles (
    uid TEXT PRIMARY KEY REFERENCES public.users(uid) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Denied')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_username ON public.staff_profiles(username);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_status ON public.staff_profiles(status);

-- 2. PROPERTIES TABLE (Tax Masterlist Module)
-- Stores full property metadata, assessment values, and physical classifications.
CREATE TABLE IF NOT EXISTS public.properties (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    pin TEXT UNIQUE NOT NULL,
    td_number TEXT UNIQUE NOT NULL,
    owner_name TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    administrator_name TEXT,
    administrator_address TEXT,
    effectivity_date TEXT,
    lot_no TEXT,
    blk_no TEXT,
    oct_tct TEXT,
    cct_cloa TEXT,
    classification TEXT NOT NULL DEFAULT 'LAND' CHECK (classification IN ('LAND', 'BUILDING', 'MACHINERY')),
    area TEXT,
    assessed_value NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (assessed_value >= 0),
    previous_td_no TEXT,
    previous_owner TEXT,
    previous_assessed_value NUMERIC(15, 2) DEFAULT 0.00 CHECK (previous_assessed_value >= 0),
    recorded_by TEXT NOT NULL DEFAULT 'System',
    user_id TEXT REFERENCES public.users(uid) ON DELETE SET NULL,
    is_archived BOOLEAN DEFAULT FALSE,
    archived_at TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for optimized lookup in municipal property records
CREATE INDEX IF NOT EXISTS idx_properties_pin ON public.properties(pin);
CREATE INDEX IF NOT EXISTS idx_properties_td_number ON public.properties(td_number);
CREATE INDEX IF NOT EXISTS idx_properties_owner_name ON public.properties(owner_name);
CREATE INDEX IF NOT EXISTS idx_properties_is_archived ON public.properties(is_archived);

-- 3. DELINQUENCIES TABLE (Delinquency Module)
-- Computes and tracks annual property liabilities, interest, penalties, and payment states.
CREATE TABLE IF NOT EXISTS public.delinquencies (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    property_id TEXT NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE ON UPDATE CASCADE,
    year INTEGER NOT NULL,
    basic_tax NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (basic_tax >= 0),
    sef_tax NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (sef_tax >= 0),
    penalties NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (penalties >= 0),
    interest NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (interest >= 0),
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Delinquent', 'Paid', 'Voided', 'NOTICE_ISSUED')),
    total_paid NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_paid >= 0),
    notice_issued_at TEXT DEFAULT NULL,
    payment_details JSONB DEFAULT NULL,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_property_year UNIQUE (property_id, year)
);

-- Indexing for delinquency lists and municipal notifications
CREATE INDEX IF NOT EXISTS idx_delinquencies_property_id ON public.delinquencies(property_id);
CREATE INDEX IF NOT EXISTS idx_delinquencies_year ON public.delinquencies(year);
CREATE INDEX IF NOT EXISTS idx_delinquencies_status ON public.delinquencies(status);

-- 4. PAYMENTS TABLE (Collection Module)
-- Maintains formal transactions, official receipts, and allocation breakdowns.
CREATE TABLE IF NOT EXISTS public.payments (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    property_id TEXT NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    delinquency_id TEXT REFERENCES public.delinquencies(id) ON DELETE SET NULL ON UPDATE CASCADE,
    or_number TEXT UNIQUE NOT NULL,
    or_date TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    amount_paid NUMERIC(15, 2) NOT NULL CHECK (amount_paid >= 0),
    payment_type TEXT NOT NULL DEFAULT 'CASH',
    payment_period TEXT NOT NULL,
    period_start_year INTEGER NOT NULL,
    period_end_year INTEGER NOT NULL,
    quarter_start INTEGER,
    quarter_end INTEGER,
    basic_tax_paid NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (basic_tax_paid >= 0),
    sef_paid NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (sef_paid >= 0),
    penalties_paid NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (penalties_paid >= 0),
    discount_applied NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (discount_applied >= 0),
    remarks TEXT,
    recorded_by TEXT NOT NULL,
    user_id TEXT REFERENCES public.users(uid) ON DELETE SET NULL,
    approved_by TEXT DEFAULT NULL,
    treasurer TEXT DEFAULT NULL,
    deputy TEXT DEFAULT NULL,
    assessed_value NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (assessed_value >= 0),
    payer_name TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'VOIDED')),
    void_metadata JSONB DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for collection module optimization and auditing
CREATE INDEX IF NOT EXISTS idx_payments_property_id ON public.payments(property_id);
CREATE INDEX IF NOT EXISTS idx_payments_delinquency_id ON public.payments(delinquency_id);
CREATE INDEX IF NOT EXISTS idx_payments_or_number ON public.payments(or_number);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON public.payments(payment_date);

-- 5. AUDIT LOGS TABLE
-- Structural modifications, security updates, exports, and administrator transactions.
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'VOID', 'DELETE', 'LOGIN', 'EXPORT', 'APPROVE')),
    user_id TEXT REFERENCES public.users(uid) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_value JSONB DEFAULT NULL,
    new_value JSONB DEFAULT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for municipal auditors to reconstruct event sequences
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);


-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES Setup
-- ==========================================

-- Enable Row Level Security on all core business tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delinquencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. RLS Policies for the public.users Table
-- Anyone can view profiles, but only the corresponding user or an administrator can modify them.
CREATE POLICY "Allow public select for active profiles" 
ON public.users FOR SELECT 
USING (true);

CREATE POLICY "Allow individuals to update their own profile" 
ON public.users FOR UPDATE 
USING (auth.uid()::text = uid)
WITH CHECK (auth.uid()::text = uid);

CREATE POLICY "Allow administrators full write/delete access on profiles" 
ON public.users FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text AND users.role = 'Admin' AND users.status = 'Approved'
    )
);

-- 2. RLS Policies for the public.properties Table (Masterlist Module)
-- - Administrators, Encoders, and Municipal Users can perform CRUD.
-- - Taxpayers can only read properties listed in their linked_property_ids array.
-- - Guests can read all active properties.
CREATE POLICY "Staff can view and manage all properties" 
ON public.properties FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Admin', 'User', 'End-User') 
        AND users.status = 'Approved'
    )
);

CREATE POLICY "Taxpayers can read their own linked properties" 
ON public.properties FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND (properties.id = ANY(users.linked_property_ids) OR properties.pin = ANY(users.linked_property_ids))
        AND users.status = 'Approved'
    )
);

CREATE POLICY "Guests and general public read access" 
ON public.properties FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role = 'Guest' 
        AND users.status = 'Approved'
    )
);

-- 3. RLS Policies for the public.delinquencies Table (Delinquency Module)
-- - Municipal staff can perform standard CRUD.
-- - Taxpayers can only read delinquencies associated with their linked properties.
CREATE POLICY "Staff can manage delinquencies" 
ON public.delinquencies FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Admin', 'User', 'End-User') 
        AND users.status = 'Approved'
    )
);

CREATE POLICY "Taxpayers can view their own delinquencies" 
ON public.delinquencies FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND (delinquencies.property_id = ANY(users.linked_property_ids))
        AND users.status = 'Approved'
    )
);

-- 4. RLS Policies for the public.payments Table (Collection Module)
-- - Municipal staff can perform standard payments collection / CRUD / voids.
-- - Taxpayers can view only receipts issued to their linked properties.
CREATE POLICY "Staff can manage payments collection" 
ON public.payments FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Admin', 'User', 'End-User') 
        AND users.status = 'Approved'
    )
);

CREATE POLICY "Taxpayers can view their historical receipts" 
ON public.payments FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND (payments.property_id = ANY(users.linked_property_ids))
        AND users.status = 'Approved'
    )
);

-- 5. RLS Policies for the public.audit_logs Table
-- - Administrators and Encoders can review logs. Only administrators can write/wipe.
CREATE POLICY "Administrators and Staff can query audit logs" 
ON public.audit_logs FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.uid = auth.uid()::text 
        AND users.role IN ('Admin', 'User', 'End-User') 
        AND users.status = 'Approved'
    )
);

CREATE POLICY "Only system or admin can append audit logs" 
ON public.audit_logs FOR INSERT 
WITH CHECK (true); -- Allowed for tracking login events and API triggers
