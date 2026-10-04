// Erzeugt einen Passwort-Hash für die Cloudflare-Secrets PASSWORD_HASH_FELIX / PASSWORD_HASH_TIM.
// Aufruf: npm run hash-password -- "MeinPasswort"
import { pbkdf2Sync, randomBytes } from "node:crypto";

const pw = process.argv[2];
if (!pw) {
  console.error('Bitte Passwort angeben: npm run hash-password -- "MeinPasswort"');
  process.exit(1);
}
const iterations = 100000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(pw, salt, iterations, 32, "sha256");
const b64 = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(`pbkdf2$${iterations}$${b64(salt)}$${b64(hash)}`);
