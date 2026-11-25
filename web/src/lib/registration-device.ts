import type { Contour } from "./contour";

const databaseName = "celmento-registration";
const storeName = "device-keys";
type Purpose = "login-proposal" | "login-availability" | "finish";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function createRegistrationDeviceKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const publicKey = base64Url(await crypto.subtle.exportKey("spki", pair.publicKey));
  // spec:impl registration-finish-screen#sign-device-registration-package
  await transact("readwrite", (store) => store.put(pair, publicKey));
  return publicKey;
}

export async function loadRegistrationDeviceKey(publicKey: string): Promise<CryptoKey | null> {
  const pair: unknown = await transact("readonly", (store) => store.get(publicKey));
  return typeof pair === "object" &&
    pair !== null &&
    "privateKey" in pair &&
    pair.privateKey instanceof CryptoKey
    ? pair.privateKey
    : null;
}

export async function signRegistration(
  privateKey: CryptoKey,
  purpose: Purpose,
  contour: Contour,
  token: string,
): Promise<string> {
  const payload = new TextEncoder().encode(
    `celmento:registration\n${purpose}\n${contour}\n${token}`,
  );
  return base64Url(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payload),
  );
}

export async function clearRegistrationDeviceKey(publicKey: string): Promise<void> {
  try {
    await transact("readwrite", (store) => store.delete(publicKey));
  } catch {
    // The server rejects expired or consumed packages if storage cleanup fails.
  }
}
