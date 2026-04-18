export class FitbitError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FitbitError";
  }
}

export class FitbitAuthError extends FitbitError {
  constructor(message: string) {
    super(message, 401);
    this.name = "FitbitAuthError";
  }
}

export class FitbitRateLimitError extends FitbitError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message, 429);
    this.name = "FitbitRateLimitError";
  }
}

export class FitbitServerError extends FitbitError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "FitbitServerError";
  }
}

export class FitbitClientError extends FitbitError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "FitbitClientError";
  }
}
