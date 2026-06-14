import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import fs from "fs";

const configPath = "firebase-applet-config.json";
const configStr = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(configStr);

const app = initializeApp({
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  appId: config.appId
});

const db = getFirestore(app, config.firestoreDatabaseId || "(default)");

async function check() {
  const pDoc = await getDoc(doc(db, "properties", "fJB0b3dAVXY0PJmyMa6v"));
  console.log("Property Data: ", pDoc.data());
  process.exit(0);
}

check().catch(console.error);
