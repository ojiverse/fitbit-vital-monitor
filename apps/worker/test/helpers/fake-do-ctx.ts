export function createFakeCtx() {
  return {
    async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}

export type FakeCtx = ReturnType<typeof createFakeCtx>;
