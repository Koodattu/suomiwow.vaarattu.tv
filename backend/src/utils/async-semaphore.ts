export default class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore limit must be a positive integer");
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      const enter = () => {
        this.active += 1;
        resolve();
      };
      if (this.active < this.limit) enter();
      else this.waiters.push(enter);
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}
