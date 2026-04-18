import type { TokenStore } from "../../src/token-store";
import type { Env } from "../../src/types";
import { type FakeD1, createFakeD1 } from "./fake-d1";
import { type FakeR2, createFakeR2 } from "./fake-r2";

export type FakeEnv = Env & {
  readonly DB: FakeD1;
  readonly ARCHIVE: FakeR2;
};

export function createFakeEnv(overrides: Partial<Env> = {}): FakeEnv {
  const db = createFakeD1();
  const r2 = createFakeR2();
  const base = {
    DB: db,
    ARCHIVE: r2,
    TOKEN_STORE: createFakeTokenStoreNamespace("ACCESS_TOKEN"),
    USER_TIMEZONE: "Asia/Tokyo",
    FITBIT_CLIENT_ID: "test-client-id",
    FITBIT_CLIENT_SECRET: "test-client-secret",
    FITBIT_REFRESH_TOKEN_SEED: "seed-refresh-token",
  };
  return { ...base, ...overrides } as FakeEnv;
}

export function createFakeTokenStoreNamespace(
  accessToken: string,
): DurableObjectNamespace<TokenStore> {
  const stub = {
    async getValidToken(): Promise<string> {
      return accessToken;
    },
  };
  const namespace = {
    idFromName(_name: string): DurableObjectId {
      return { toString: () => "fake-id" } as unknown as DurableObjectId;
    },
    get(_id: DurableObjectId): DurableObjectStub<TokenStore> {
      return stub as unknown as DurableObjectStub<TokenStore>;
    },
  };
  return namespace as unknown as DurableObjectNamespace<TokenStore>;
}
