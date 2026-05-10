import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfig = JSON.parse(readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const dbId = firebaseConfig.firestoreDatabaseId;
const db = (dbId && dbId !== "(default)") ? getFirestore(admin.app(), dbId) : getFirestore();


async function run() {
  const pin = "06-0005-00123";
  let propId = null;

  // 1. Find the property using this PIN
  const props = await db.collection("properties").where("pin", "==", pin).get();
  if (props.empty) {
    console.log("No property found with PIN:", pin);
  } else {
    for (const doc of props.docs) {
      propId = doc.id;
      console.log(`Found property: ${doc.id} for PIN ${pin}. Deleting...`);
      await db.collection("properties").doc(doc.id).delete();
    }
  }

  // 2. Find any delinquencies associated with this propertyId
  if (propId) {
    const delinqs = await db.collection("delinquencies").where("propertyId", "==", propId).get();
    for (const doc of delinqs.docs) {
      console.log(`Deleting delinquency ${doc.id}`);
      await db.collection("delinquencies").doc(doc.id).delete();
    }
  } else {
    // maybe try to find any delinquencies referencing a non-existent property
    console.log("No prop id, deleting directly by scanning delinquencies? Nah we just want to remove Leonardo '06-0005-00123'");
  }

  process.exit(0);
}

run().catch(console.error);
