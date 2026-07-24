import express, { type Response, type NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

console.log("--- Server Starting ---");

let __filename = "";
let __dirname = "";

try {
  if (typeof import.meta !== "undefined" && import.meta.url) {
    __filename = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename);
  } else {
    __dirname = process.cwd();
    __filename = path.join(__dirname, "server.ts");
  }
} catch {
  __dirname = process.cwd();
  __filename = path.join(__dirname, "server.ts");
}

// Read Supabase environment variables
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const isValidUrl = (url: string): boolean => {
  try {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim().toLowerCase();
    if (
      !trimmed || 
      trimmed.includes('your-supabase-url') || 
      trimmed.includes('your_supabase_url') || 
      trimmed.includes('placeholder') ||
      trimmed.includes('<project>')
    ) {
      return false;
    }
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const isSupabaseConfigured = isValidUrl(supabaseUrl) && !!supabaseAnonKey.trim() && !supabaseAnonKey.includes('your-anon-key');

if (!isSupabaseConfigured) {
  console.warn("WARNING: Supabase environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) are not set or invalid.");
}

let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (!supabaseClient && isSupabaseConfigured) {
    try {
      supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
    } catch (err) {
      console.warn("Failed to create Supabase server client:", err);
      supabaseClient = null;
    }
  }
  return supabaseClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  // --- Payment Voiding Route ---
  app.post("/api/payments/invalidate", async (req: any, res: Response) => {
    const { adminEmail, adminPassword, orNumber, reason } = req.body;
    try {
      const supabase = getSupabaseClient();
      if (!isSupabaseConfigured || !supabase) {
        return res.status(503).json({ error: "Service Unavailable: Supabase integration is not configured on this server." });
      }

      const client = supabase as any;

      if (!adminEmail || !adminPassword || !orNumber || !reason) {
        return res.status(400).json({ error: "Missing required fields for voiding." });
      }

      console.log(`Attempting to void payment O.R. Number: ${orNumber} by Admin: ${adminEmail}`);

      // 1. Verify admin credentials via Supabase Auth
      const { data: authData, error: authError } = await client.auth.signInWithPassword({
        email: adminEmail,
        password: adminPassword,
      });

      if (authError || !authData.user) {
        console.warn(`Admin login failed during voiding for ${adminEmail}:`, authError?.message);
        return res.status(401).json({ error: "Unauthorized: Invalid Admin Credentials." });
      }

      // 2. Fetch admin profile from "users" table to verify role
      const { data: profile, error: profileError } = await client
        .from("users")
        .select("*")
        .eq("uid", authData.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        console.warn(`Admin profile not found in public 'users' table for uid: ${authData.user.id}`);
        return res.status(401).json({ error: "Unauthorized: Admin Profile not found." });
      }

      if (profile.role !== "Admin") {
        console.warn(`User ${adminEmail} does not have Admin privileges. Role found: ${profile.role}`);
        return res.status(401).json({ error: "Unauthorized: Invalid Admin Privileges." });
      }

      // 3. Fetch payments under this O.R. Number
      const { data: payments, error: paymentsError } = await client
        .from("payments")
        .select("*")
        .eq("or_number", orNumber);

      if (paymentsError) {
        console.error("Error fetching payments from database:", paymentsError);
        throw paymentsError;
      }

      if (!payments || payments.length === 0) {
        return res.status(404).json({ error: `No payment records found with O.R. Number ${orNumber}` });
      }

      const currentYear = new Date().getFullYear();

      // 4. Update payments and associate delinquencies
      for (const payment of payments) {
        const voidMetadata = {
          reason,
          voidedAt: new Date().toISOString(),
          voidedBy: adminEmail
        };

        // Mark payment as Voided in Supabase
        const { error: updatePaymentError } = await client
          .from("payments")
          .update({
            status: "Voided",
            void_metadata: voidMetadata
          })
          .eq("id", payment.id);

        if (updatePaymentError) {
          console.error(`Error voiding payment ID ${payment.id}:`, updatePaymentError);
          throw updatePaymentError;
        }

        // Restore delinquency status
        if (payment.delinquency_id) {
          const { data: delinquency, error: delFetchError } = await client
            .from("delinquencies")
            .select("*")
            .eq("id", payment.delinquency_id)
            .maybeSingle();

          if (!delFetchError && delinquency) {
            const originalYear = delinquency.year || payment.tax_year || currentYear;
            const restoredStatus = originalYear >= currentYear ? "Pending" : "Delinquent";

            const { error: updateDelError } = await client
              .from("delinquencies")
              .update({
                status: restoredStatus,
                total_paid: 0,
                updated_at: new Date().toISOString(),
                payment_details: null
              })
              .eq("id", delinquency.id);

            if (updateDelError) {
              console.error(`Error updating delinquency ${delinquency.id}:`, updateDelError);
              throw updateDelError;
            }
          }
        } else {
          // Fallback: Query delinquency by property_id and year
          const { data: delDocs, error: delQueryError } = await client
            .from("delinquencies")
            .select("*")
            .eq("property_id", payment.property_id)
            .eq("year", payment.tax_year || currentYear);

          if (!delQueryError && delDocs && delDocs.length > 0) {
            for (const dDoc of delDocs) {
              const originalYear = dDoc.year || currentYear;
              const restoredStatus = originalYear >= currentYear ? "Pending" : "Delinquent";

              const { error: updateDelError } = await client
                .from("delinquencies")
                .update({
                  status: restoredStatus,
                  total_paid: 0,
                  updated_at: new Date().toISOString(),
                  payment_details: null
                })
                .eq("id", dDoc.id);

              if (updateDelError) {
                console.error(`Fallback error updating delinquency ${dDoc.id}:`, updateDelError);
                throw updateDelError;
              }
            }
          }
        }
      }

      // 5. Log into system-wide audit trail
      const auditId = crypto.randomUUID();
      const { error: auditError } = await client
        .from("audit_logs")
        .insert({
          id: auditId,
          userId: authData.user.id,
          userEmail: authData.user.email,
          action: "VOID",
          entityId: orNumber,
          entityType: "Collection",
          oldValue: { orNumber, status: "Active" },
          newValue: { orNumber, status: "Voided", voidReason: reason, voidedBy: adminEmail },
          timestamp: new Date().toISOString()
        });

      if (auditError) {
        console.warn("Audit logging warning:", auditError);
      }

      console.log(`Successfully voided O.R. Number: ${orNumber}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Voiding process failure:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
