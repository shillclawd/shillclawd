import "dotenv/config";
import app from "./app.js";
import { startCronJobs } from "./cron/jobs.js";

// Prevent server crash on unhandled errors
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ShillClawd API running on port ${PORT}`);
  startCronJobs();
});
