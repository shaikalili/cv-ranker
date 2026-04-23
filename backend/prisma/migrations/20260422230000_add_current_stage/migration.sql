-- AddColumn: track coarse pipeline phase on the job_positions row
-- so polling clients can see progress without relying on the in-memory
-- SSE stream. NULL when no run is active.
ALTER TABLE "job_positions" ADD COLUMN "currentStage" TEXT;
