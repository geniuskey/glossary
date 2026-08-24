import { createDb, users } from "@grossary/db";
import { hashPassword } from "../src/lib/auth/password.js";

const [email, password, name] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: tsx scripts/seed-admin.ts <email> <password> [name]");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL!);
await db.insert(users).values({
  email,
  name: name ?? email,
  passwordHash: await hashPassword(password),
  role: "admin",
});
console.log(`admin created: ${email}`);
process.exit(0);
