type StoredObject = {
  readonly key: string;
  readonly body: string;
  readonly httpMetadata: { contentType?: string };
};

export type FakeR2 = R2Bucket & {
  readonly store: Map<string, StoredObject>;
};

export function createFakeR2(): FakeR2 {
  const store = new Map<string, StoredObject>();
  const bucket = {
    async head(key: string): Promise<R2Object | null> {
      const obj = store.get(key);
      return obj ? ({ key, size: obj.body.length } as unknown as R2Object) : null;
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      const obj = store.get(key);
      if (!obj) return null;
      return {
        key,
        async text() {
          return obj.body;
        },
        async json() {
          return JSON.parse(obj.body);
        },
        async arrayBuffer() {
          return new TextEncoder().encode(obj.body).buffer;
        },
        body: null,
      } as unknown as R2ObjectBody;
    },
    async put(
      key: string,
      value: string | ReadableStream | ArrayBuffer | Blob,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<R2Object> {
      const body = typeof value === "string" ? value : String(value);
      const entry: StoredObject = { key, body, httpMetadata: options?.httpMetadata ?? {} };
      store.set(key, entry);
      return { key, size: body.length } as unknown as R2Object;
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<R2Objects> {
      return {
        objects: Array.from(store.keys()).map(
          (k) => ({ key: k, size: store.get(k)?.body.length ?? 0 }) as unknown as R2Object,
        ),
        truncated: false,
      } as unknown as R2Objects;
    },
  };
  return Object.assign(bucket as unknown as R2Bucket, { store });
}
