import "dotenv/config";
import app from "./app.js";
import { startCronJobs } from "./cron/jobs.js";

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ShillClawd API running on port ${PORT}`);
  startCronJobs();
});
