import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firebaseConfigReady = !Object.values(firebaseConfig).some((value) => String(value).includes("YOUR_") || value === "SENDER_ID" || value === "APP_ID");
const db = getFirestore(app);
const functions = getFunctions(app);
const dataCollections = ["cards", "people", "transactions", "payments", "incomes", "monthlyStatements"];

export function watchUserAccess(uid, onInactive, onError) {
  return onSnapshot(doc(db, "userAccess", uid), (snapshot) => {
    if (!snapshot.exists() || snapshot.data().active !== true) onInactive();
  }, onError);
}

export async function loadCloudState(uid) {
  if (auth.currentUser?.uid !== uid) throw new Error("The signed-in account changed before its data loaded.");
  const collectionSnapshots = await Promise.all(dataCollections.map((name) => getDocs(collection(db, "users", uid, name))));
  const profileSnapshot = await getDoc(doc(db, "users", uid, "settings", "profile"));
  const state = { currency: profileSnapshot.exists() ? profileSnapshot.data().currency : "USD" };
  collectionSnapshots.forEach((snapshot, index) => {
    state[dataCollections[index]] = snapshot.docs.map((record) => ({ ...record.data(), id: record.id }));
  });
  return {
    state,
    hasData: profileSnapshot.exists() || collectionSnapshots.some((snapshot) => !snapshot.empty)
  };
}

export async function saveCloudState(uid, nextState, previousState) {
  if (auth.currentUser?.uid !== uid) throw new Error("The signed-in account changed before data could be saved.");
  const operations = [];
  for (const name of dataCollections) {
    const currentRecords = new Map((nextState[name] || []).map((record) => [record.id, record]));
    const previousRecords = new Map((previousState[name] || []).map((record) => [record.id, record]));
    for (const [recordId, record] of currentRecords) {
      if (typeof recordId !== "string" || !recordId || recordId.includes("/")) throw new Error(`Invalid ${name} record identifier.`);
      if (JSON.stringify(record) !== JSON.stringify(previousRecords.get(recordId))) {
        const { id: ignoredId, ...data } = record;
        operations.push({ type: "set", reference: doc(db, "users", uid, name, recordId), data });
      }
    }
    for (const recordId of previousRecords.keys()) {
      if (!currentRecords.has(recordId)) operations.push({ type: "delete", reference: doc(db, "users", uid, name, recordId) });
    }
  }
  if (nextState.currency !== previousState.currency) {
    operations.push({
      type: "set",
      reference: doc(db, "users", uid, "settings", "profile"),
      data: { currency: nextState.currency }
    });
  }
  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = writeBatch(db);
    operations.slice(offset, offset + 450).forEach((operation) => {
      if (operation.type === "set") batch.set(operation.reference, operation.data);
      else batch.delete(operation.reference);
    });
    await batch.commit();
  }
}

export async function createManagedUser(email, password) {
  const call = httpsCallable(functions, "createManagedUser");
  return (await call({ email, password })).data;
}

export async function listManagedUsers() {
  const call = httpsCallable(functions, "listManagedUsers");
  return (await call()).data.users;
}

export async function setManagedUserEnabled(uid, enabled) {
  const call = httpsCallable(functions, "setManagedUserEnabled");
  return (await call({ uid, enabled })).data;
}
