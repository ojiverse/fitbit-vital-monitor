export function createFakeCtx() {
  const storage = new Map<string, unknown>();
  return {
    async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return storage.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        storage.set(key, value);
      },
      async delete(key: string): Promise<boolean> {
        return storage.delete(key);
      },
    },
  };
}

export type FakeCtx = ReturnType<typeof createFakeCtx>;
