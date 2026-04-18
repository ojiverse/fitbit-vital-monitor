// Stub for the `cloudflare:workers` module when tests run under plain Node.
// Only the fragments our code imports need to exist.

export class DurableObject<Env = unknown> {
  readonly ctx: DurableObjectState;
  readonly env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

type DurableObjectState = {
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
};
