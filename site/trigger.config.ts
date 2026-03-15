import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_xdedcsbsuvqwgqiszclp",
  dirs: ["./src/trigger"],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
});
