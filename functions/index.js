const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();

function requireAdmin(request) {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
}

exports.createManagedUser = onCall(async (request) => {
  requireAdmin(request);
  const email = typeof request.data?.email === "string" ? request.data.email.trim().toLowerCase() : "";
  const password = typeof request.data?.password === "string" ? request.data.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  if (password.length < 10) {
    throw new HttpsError("invalid-argument", "The temporary password must be at least 10 characters.");
  }
  try {
    const user = await getAuth().createUser({ email, password, disabled: false });
    try {
      await getFirestore().doc(`userAccess/${user.uid}`).set({ active: true });
    } catch (error) {
      await getAuth().deleteUser(user.uid);
      throw error;
    }
    return { uid: user.uid, email: user.email, disabled: user.disabled };
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "An account already exists for that email.");
    }
    console.error("Admin account creation failed.", error);
    throw new HttpsError("internal", "Could not create the account.");
  }
});

exports.listManagedUsers = onCall(async (request) => {
  requireAdmin(request);
  const auth = getAuth();
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users.map((user) => ({
      uid: user.uid,
      email: user.email || "",
      disabled: user.disabled,
      admin: user.customClaims?.admin === true
    })));
    pageToken = page.pageToken;
  } while (pageToken);
  return { users };
});

exports.setManagedUserEnabled = onCall(async (request) => {
  requireAdmin(request);
  const uid = typeof request.data?.uid === "string" ? request.data.uid : "";
  const enabled = request.data?.enabled;
  if (!uid || typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "A user ID and active status are required.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot change your own account status.");
  }
  try {
    const existingUser = await getAuth().getUser(uid);
    if (existingUser.customClaims?.admin === true) {
      throw new HttpsError("failed-precondition", "Administrator accounts cannot be disabled here.");
    }
    const accessRef = getFirestore().doc(`userAccess/${uid}`);
    if (!enabled) await accessRef.set({ active: false }, { merge: true });
    const user = await getAuth().updateUser(uid, { disabled: !enabled });
    if (enabled) await accessRef.set({ active: true }, { merge: true });
    else await getAuth().revokeRefreshTokens(uid);
    return { uid: user.uid, disabled: user.disabled };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error.code === "auth/user-not-found") {
      throw new HttpsError("not-found", "That account no longer exists.");
    }
    console.error("Admin account status update failed.", error);
    throw new HttpsError("internal", "Could not update the account status.");
  }
});
