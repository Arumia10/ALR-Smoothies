import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
const output = new Writable({
  write(chunk, encoding, done) {
    done();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
process.stdout.write(
  "Choose a team password (at least 16 characters; input hidden): ",
);
rl.question("", (password) => {
  rl.close();
  process.stdout.write("\n");
  if (password.length < 16) {
    console.error("Please use at least 16 characters.");
    process.exitCode = 1;
    return;
  }
  const salt = randomBytes(16).toString("hex");
  console.log(
    `Add this to .env:\nADMIN_PASSWORD_HASH=${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  );
});
