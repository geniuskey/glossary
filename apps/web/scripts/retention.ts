import { runDataRetention } from "../src/lib/retention";

runDataRetention()
  .then((result) => {
    console.info("[retention] completed", result);
  })
  .catch((error) => {
    console.error("[retention] failed", error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" });
    process.exitCode = 1;
  });
