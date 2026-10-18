const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const email = process.argv[2] === "--email" ? process.argv[3] : process.argv[2];
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;

if (!email || !projectId) {
  console.error("Set GCLOUD_PROJECT (or FIREBASE_PROJECT_ID), then run node scripts/set-admin.js [--email] admin@example.com");
  process.exitCode = 1;
} else {
  initializeApp({ projectId });
  getAuth().getUserByEmail(email).then(async (user) => {
    await getAuth().setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
    await getFirestore().doc(`userAccess/${user.uid}`).set({ active: true }, { merge: true });
    console.log(`Administrator access enabled for ${user.email}. Sign out and back in to refresh the account.`);
  }).catch((error) => {
    if (error.code === "auth/invalid-email") {
      console.error("Invalid email argument. Use node scripts/set-admin.js sherwin.inson.ai@gmail.com or node scripts/set-admin.js --email sherwin.inson.ai@gmail.com.");
    } else if (error.code === "auth/user-not-found") {
      console.error("No Firebase Authentication user exists for that email. Create the user in Firebase Console first.");
    } else if (/default credentials|Could not load the default credentials/i.test(error.message || "")) {
      console.error("Google Application Default Credentials are not configured. Install the Google Cloud CLI, run `gcloud auth application-default login`, then rerun this script from the same Windows account.");
    } else {
      console.error("Could not promote this account. Confirm the email, Firebase project, and Admin credentials.", error.message);
    }
    process.exitCode = 1;
  });
}
