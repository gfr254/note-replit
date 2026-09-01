import { pool } from "@workspace/db";
import { runContentSchedulerOnce } from "./content/scheduler";
import { runPublisherOnce } from "./publishers/runner";
import { logger } from "./lib/logger";

async function runWeeklyPublish() {
  const queued = await runContentSchedulerOnce();
  let drainedJobs = 0;

  while (await runPublisherOnce()) {
    drainedJobs += 1;
  }

  logger.info({ queued, drainedJobs }, "Weekly publish run completed");
}

runWeeklyPublish()
  .catch((error) => {
    logger.error({ err: error }, "Weekly publish run failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });