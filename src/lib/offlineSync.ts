import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  getDocs, 
  query, 
  where, 
  limit, 
  serverTimestamp,
  db
} from "./firebase";
import { logAudit } from "./audit";

export type OfflineTaskType = 'RECORD_PAYMENT' | 'CREATE_PROPERTY' | 'UPDATE_PROPERTY';

export interface OfflineTask {
  id: string;
  type: OfflineTaskType;
  data: any;
  description: string;
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
  error?: string;
}

const LOCAL_STORAGE_KEY = "rpt_offline_sync_queue";

// Helper to get queue
export function getOfflineQueue(): OfflineTask[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to read offline queue from storage", err);
    return [];
  }
}

// Helper to save queue
export function saveOfflineQueue(queue: OfflineTask[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(queue));
    // Dispatch custom event so the UI updates instantly across components
    window.dispatchEvent(new CustomEvent("rpt-offline-queue-changed", { detail: queue }));
  } catch (err) {
    console.error("Failed to save offline queue to storage", err);
  }
}

// Helper to add to queue
export function addToOfflineQueue(type: OfflineTaskType, data: any, description: string): OfflineTask {
  const queue = getOfflineQueue();
  const newTask: OfflineTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    type,
    data,
    description,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  queue.push(newTask);
  saveOfflineQueue(queue);
  return newTask;
}

if (typeof window !== "undefined") {
  window.addEventListener("rpt-add-offline-task", (e: any) => {
    if (e.detail) {
      const { type, data, description } = e.detail;
      // Avoid duplicate tasks with the exact same ID
      const queue = getOfflineQueue();
      if (!queue.some(t => t.data?.id === data?.id)) {
        addToOfflineQueue(type as OfflineTaskType, data, description);
      }
    }
  });
}

// Helper to remove from queue
export function removeFromOfflineQueue(id: string) {
  const queue = getOfflineQueue();
  const nextQueue = queue.filter(task => task.id !== id);
  saveOfflineQueue(nextQueue);
}

// Helper to update task status
export function updateTaskStatus(id: string, status: 'pending' | 'syncing' | 'failed', error?: string) {
  const queue = getOfflineQueue();
  const nextQueue = queue.map(task => {
    if (task.id === id) {
      return { ...task, status, error };
    }
    return task;
  });
  saveOfflineQueue(nextQueue);
}

// Function to process a single RECORD_PAYMENT task
async function syncRecordPayment(task: OfflineTask) {
  const { 
    selectedProperty, 
    orNumber, 
    orDate, 
    taxPayer, 
    paymentMode, 
    quarters, 
    isAdvance, 
    isCash, 
    checkNumber, 
    checkPayee, 
    checkDate, 
    isCheck, 
    treasurer, 
    deputy, 
    paymentDetailsList,
    recordedBy
  } = task.data;

  // 1. UNIQUE O.R. CHECK
  const orQuery = query(
    collection(db, "payments"),
    where("orNumber", "==", orNumber.trim()),
    where("status", "==", "Active"),
    limit(1)
  );
  const orSnap = await getDocs(orQuery);
  if (!orSnap.empty) {
    throw new Error(`Duplicate Official Receipt Number ${orNumber} has already been used.`);
  }

  // 2. Loop through each payment record to be processed
  for (const record of paymentDetailsList) {
    let targetDelinqId = record.delinquencyId;

    // Check if virtual advance
    if (record.delinquencyId.startsWith("advance-") || record.isAdvanceVirtual) {
      const nextYear = record.year || (new Date().getFullYear() + 1);
      const newDelinqPayload = {
        propertyId: selectedProperty.id,
        year: nextYear,
        basicTaxDue: record.basicTaxDue,
        sefTaxDue: record.sefTaxDue,
        penalty: 0,
        interest: 0,
        totalDue: record.basicTaxDue + record.sefTaxDue,
        totalPaid: 0,
        status: "Delinquent",
        recordedBy: recordedBy || "System",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      const delinqDocRef = await addDoc(collection(db, "delinquencies"), newDelinqPayload);
      targetDelinqId = delinqDocRef.id;
    }

    // 3. Double Taxation Safety Check
    const dtQuery = query(
      collection(db, "payments"),
      where("propertyId", "==", selectedProperty.id),
      where("taxYear", "==", record.year),
      where("status", "==", "Active")
    );
    const dtSnap = await getDocs(dtQuery);
    if (!dtSnap.empty) {
      const existing = dtSnap.docs.map(doc => doc.data());
      const doubleCheck = existing.find(r => r.assessedValue === selectedProperty.assessedValue);
      if (doubleCheck) {
        throw new Error(`Tax for Year ${record.year} has already been settled for this property.`);
      }
    }

    // 4. Create the Payment document
    const paymentPayload = {
      propertyId: selectedProperty.id,
      delinquencyId: targetDelinqId,
      taxYear: record.year,
      assessedValue: selectedProperty.assessedValue,
      orNumber: orNumber.trim(),
      paymentDate: orDate,
      payerName: taxPayer,
      paymentType: paymentMode === "Installment" ? `Installment (${quarters.join(", ")})` : "Full",
      isAdvance: isAdvance || false,
      settlementMethod: isCash ? "Cash" : "Check",
      checkDetails: isCheck ? {
        number: checkNumber.trim(),
        payee: checkPayee.trim(),
        date: checkDate
      } : null,
      amountPaid: record.totalDue,
      basicPaid: record.basicTaxDue,
      sefPaid: record.sefTaxDue,
      penaltyPaid: record.interest || 0,
      discountPaid: record.discount || 0,
      treasurer: treasurer.trim(),
      deputy: deputy.trim(),
      recordedBy: recordedBy || "System",
      status: "Active",
      recordedAt: new Date().toISOString()
    };
    await addDoc(collection(db, "payments"), paymentPayload);

    // 5. Update Delinquency Status to Paid
    const dsQuery = query(
      collection(db, "delinquencies"),
      where("propertyId", "==", selectedProperty.id),
      where("year", "==", record.year)
    );
    const dsSnap = await getDocs(dsQuery);
    for (const delinqDoc of dsSnap.docs) {
      await updateDoc(doc(db, "delinquencies", delinqDoc.id), {
        status: "Paid",
        totalPaid: record.totalDue,
        updatedAt: serverTimestamp(),
        paymentDetails: {
          orNumber: orNumber.trim(),
          paymentDate: orDate,
          amountPaid: record.totalDue,
          paymentType: paymentMode
        }
      });
    }
  }

  // 6. Log Audit Log
  await logAudit("CREATE", "Collection", orNumber.trim(), null, {
    orNumber: orNumber.trim(),
    propertyId: selectedProperty.id,
    amount: paymentDetailsList.reduce((acc: number, item: any) => acc + item.totalDue, 0)
  });
}

// Function to process a single CREATE_PROPERTY task
async function syncCreateProperty(task: OfflineTask) {
  const { propertyData, recordedBy } = task.data;
  
  const propertyPayload = {
    ...propertyData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, "properties"), propertyPayload);
  
  await logAudit("CREATE", "Property", propertyData.tdNumber, null, {
    id: docRef.id,
    tdNumber: propertyData.tdNumber,
    ownerName: propertyData.ownerName,
    assessedValue: propertyData.assessedValue
  });
}

// Function to process a single UPDATE_PROPERTY task
async function syncUpdateProperty(task: OfflineTask) {
  const { propertyId, updateData, tdNumber } = task.data;

  await updateDoc(doc(db, "properties", propertyId), {
    ...updateData,
    updatedAt: serverTimestamp()
  });

  await logAudit("UPDATE", "Property", tdNumber, null, {
    id: propertyId,
    updateData
  });
}

// Core Runner to process the queue
let isProcessing = false;

export async function processOfflineQueue(): Promise<{ successCount: number; failCount: number }> {
  if (isProcessing) return { successCount: 0, failCount: 0 };
  
  const queue = getOfflineQueue();
  if (queue.length === 0) return { successCount: 0, failCount: 0 };

  // Only check navigator.onLine as general guard, but firestore itself decides connectivity
  if (!navigator.onLine) {
    console.log("OfflineSync: Navigator is offline, skipping sync.");
    return { successCount: 0, failCount: 0 };
  }

  isProcessing = true;
  let successCount = 0;
  let failCount = 0;

  console.log(`OfflineSync: Starting sync for ${queue.length} pending items...`);

  for (const task of queue) {
    if (task.status === 'syncing') continue;

    try {
      updateTaskStatus(task.id, 'syncing');

      if (task.type === 'RECORD_PAYMENT') {
        await syncRecordPayment(task);
      } else if (task.type === 'CREATE_PROPERTY') {
        await syncCreateProperty(task);
      } else if (task.type === 'UPDATE_PROPERTY') {
        await syncUpdateProperty(task);
      }

      // Successfully synced! Remove from queue.
      removeFromOfflineQueue(task.id);
      successCount++;
    } catch (err: any) {
      console.error(`OfflineSync: Task ${task.id} failed to sync:`, err);
      updateTaskStatus(task.id, 'failed', err.message || String(err));
      failCount++;
    }
  }

  isProcessing = false;
  
  if (successCount > 0 || failCount > 0) {
    // Notify window that sync has completed
    window.dispatchEvent(new CustomEvent("rpt-offline-sync-result", { 
      detail: { successCount, failCount } 
    }));
  }

  return { successCount, failCount };
}

// Auto-Sync Setup on Reconnection
export function initializeAutoSync() {
  if (typeof window === "undefined") return;

  const handleOnline = () => {
    console.log("OfflineSync: Connection restored. Automatically processing sync queue...");
    // Let's add an explicit small delay to ensure Firebase reconnects and validates session
    setTimeout(() => {
      processOfflineQueue().catch(err => console.error("Error running auto-sync:", err));
    }, 3000);
  };

  window.addEventListener("online", handleOnline);

  // Initial immediate processing check on load if online
  if (navigator.onLine) {
    setTimeout(() => {
      processOfflineQueue().catch(err => console.error("Initial run offline sync failed:", err));
    }, 5000);
  }

  return () => {
    window.removeEventListener("online", handleOnline);
  };
}
