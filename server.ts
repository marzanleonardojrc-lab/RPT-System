import express, { type Response, type NextFunction } from "express";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import { readFileSync } from "fs";

console.log("--- Server Starting ---");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read config safely
const firebaseConfig = JSON.parse(readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));

const JWT_SECRET = process.env.JWT_SECRET || "rpt-local-secret-key-12345";
const adminEmail = "marzanleonardojrc@gmail.com";

// --- Firebase Admin Configuration ---
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

// Get Firestore instance.
const dbId = firebaseConfig.firestoreDatabaseId;
const db = (dbId && dbId !== "(default)") ? getFirestore(dbId) : getFirestore();
console.log(`Using Firestore Database ${dbId && dbId !== "(default)" ? `ID: ${dbId}` : "Default"}`);

async function initDb() {
  try {
    // Health check
    await db.collection("health").doc("check").get();
    console.log("Connected to Firestore via Firebase Admin.");

    // --- Seed Admin User ---
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("email", "==", adminEmail).limit(1).get();
    
    if (snapshot.empty) {
      const hashedPassword = bcrypt.hashSync("admin123", 10);
      const uid = "admin-uuid-001";
      await usersRef.doc(uid).set({
        uid,
        email: adminEmail,
        password: hashedPassword,
        displayName: "Admin Leonardo",
        role: "Admin",
        status: "Approved",
        createdAt: new Date().toISOString()
      });
      console.log("Admin user seeded: marzanleonardojrc@gmail.com / admin123");
    }
  } catch (err: any) {
    console.error("--- FIRESTORE INITIALIZATION ERROR ---");
    console.error(err);
    console.error("---------------------------------------");
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  // --- Auth Middleware ---
  const authenticateToken = (req: any, res: Response, next: NextFunction) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: "Forbidden" });
      req.user = user;
      next();
    });
  };

  // --- Auth Routes ---
  app.post("/api/auth/register", async (req, res) => {
    const { email, password, name } = req.body;
    try {
      const hashedPassword = await bcrypt.hashSync(password, 10);
      const uid = Math.random().toString(36).substring(2, 15);
      const isAdminEmail = email === adminEmail;
      
      await db.collection("users").doc(uid).set({
        uid,
        email,
        password: hashedPassword,
        displayName: name,
        role: isAdminEmail ? "Admin" : "End-User",
        status: isAdminEmail ? "Approved" : "Pending",
        createdAt: new Date().toISOString()
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    try {
      const snapshot = await db.collection("users").where("email", "==", email).limit(1).get();
      
      if (snapshot.empty) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const user = snapshot.docs[0].data();
      
      if (!bcrypt.compareSync(password, user.password || "")) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign({ uid: user.uid, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "24h" });
      res.cookie("token", token, { 
        httpOnly: true, 
        sameSite: "none", 
        secure: true,
        maxAge: 24 * 60 * 60 * 1000 
      });
      
      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token", { sameSite: "none", secure: true });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ user: null });
    
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      const userDoc = await db.collection("users").doc(decoded.uid).get();
      if (!userDoc.exists) return res.json({ user: null });
      
      const user = userDoc.data();
      res.json({ user });
    } catch {
      res.json({ user: null });
    }
  });

  app.post("/api/auth/update-profile", authenticateToken, async (req: any, res) => {
    const { displayName, password } = req.body;
    const updates: any = {};

    if (displayName) updates.displayName = displayName;
    if (password) updates.password = bcrypt.hashSync(password, 10);

    if (Object.keys(updates).length > 0) {
      await db.collection("users").doc(req.user.uid).update(updates);
    }
    res.json({ success: true });
  });

  // --- Property Routes ---
  app.get("/api/properties", authenticateToken, async (req, res) => {
    try {
      const snapshot = await db.collection("properties").get();
      const properties = snapshot.docs.map(doc => doc.data());
      res.json(properties);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/properties", authenticateToken, async (req, res) => {
    const { 
      pin, ownerName, ownerAddress, administratorName, administratorAddress, 
      effectivityDate, tdNumber, detailedLocation, street, barangay, 
      municipality, province, lotNo, blkNo, octTct, cctCloa, 
      classification, area, assessedValue, previousTdNo, previousOwner, 
      previousAssessedValue, recordedBy 
    } = req.body;
    const id = Math.random().toString(36).substring(2, 15);
    const now = new Date().toISOString();
    try {
      await db.collection("properties").doc(id).set({
        id, pin, ownerName, ownerAddress, administratorName, administratorAddress, 
        effectivityDate, tdNumber, detailedLocation, street, barangay, 
        municipality, province, lotNo, blkNo, octTct, cctCloa, 
        classification, area, assessedValue, previousTdNo, previousOwner, 
        previousAssessedValue, recordedBy, 
        updatedAt: now, createdAt: now
      });
      res.json({ id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Delinquency Routes ---
  app.get("/api/delinquencies", authenticateToken, async (req, res) => {
    const propertyId = req.query.propertyId as string;
    try {
      let q = db.collection("delinquencies") as any;
      if (propertyId) {
        q = q.where("propertyId", "==", propertyId);
      }
      const snapshot = await q.get();
      const delinquencies = snapshot.docs.map((doc: any) => doc.data());
      res.json(delinquencies);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/delinquencies", authenticateToken, async (req: any, res) => {
    const { propertyId, year, basicTaxDue, sefTaxDue, penalty, interest, totalDue, status } = req.body;
    const id = Math.random().toString(36).substring(2, 15);
    const now = new Date().toISOString();
    try {
      await db.collection("delinquencies").doc(id).set({
        id, propertyId, year, basicTaxDue, sefTaxDue, penalty, interest, totalDue, status, updatedAt: now, createdAt: now
      });
      res.json({ id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/delinquencies/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status, paymentDetails } = req.body;
    const now = new Date().toISOString();
    
    try {
      await db.collection("delinquencies").doc(id).update({
        status, paymentDetails, updatedAt: now
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- User Management (Admin Only) ---
  app.get("/api/users", authenticateToken, async (req: any, res) => {
    if (req.user.role !== "Admin") return res.status(403).json({ error: "Unauthorized" });
    try {
      const snapshot = await db.collection("users").get();
      const users = snapshot.docs.map(doc => {
        const { password, ...rest } = doc.data();
        return rest;
      });
      res.json(users);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/users/:uid", authenticateToken, async (req: any, res) => {
    if (req.user.role !== "Admin") return res.status(403).json({ error: "Unauthorized" });
    const { uid } = req.params;
    const { role, status } = req.body;
    
    const updates: any = {};
    if (role) updates.role = role;
    if (status) updates.status = status;
    
    if (Object.keys(updates).length > 0) {
      await db.collection("users").doc(uid).update(updates);
    }
    res.json({ success: true });
  });

  // --- Audit Log Routes ---
  app.get("/api/audit_logs", authenticateToken, async (req: any, res) => {
    try {
      const snapshot = await db.collection("audit_logs").orderBy("timestamp", "desc").get();
      const logs = snapshot.docs.map(doc => doc.data());
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/audit_logs", authenticateToken, async (req: any, res) => {
    const { action, entityId, entityType, oldValue, newValue } = req.body;
    try {
      const id = Math.random().toString(36).substring(2, 15);
      await db.collection("audit_logs").doc(id).set({
        id,
        userId: req.user.uid,
        userEmail: req.user.email,
        action,
        entityId,
        entityType,
        oldValue,
        newValue,
        timestamp: new Date().toISOString()
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Run DB init in background
    initDb().catch(err => {
      console.error("Delayed DB Init failed:", err);
    });
  });
}

startServer();
