import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("../../migrations");
  return {
    test: {
      include: ["test-workers/**/*.test.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          isolatedStorage: true,
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              FITBIT_CLIENT_ID: "test-client-id",
              FITBIT_CLIENT_SECRET: "test-client-secret",
              FITBIT_REFRESH_TOKEN_SEED: "test-seed-refresh",
            },
          },
        },
      },
    },
  };
});
