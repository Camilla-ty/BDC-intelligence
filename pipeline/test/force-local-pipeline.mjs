// Preload for ordinary pipeline test suites (`node --import …`).
// Forces local Docker targeting and clears Hosted opt-in so an inherited
// PIPELINE_DATABASE_URL cannot redirect queryRows/runScript to Hosted.

import { PIPELINE_ALLOW_HOSTED_ENV, PIPELINE_TEST_LOCAL_ENV } from "../lib/db.mjs";

process.env[PIPELINE_TEST_LOCAL_ENV] = "1";
delete process.env[PIPELINE_ALLOW_HOSTED_ENV];
