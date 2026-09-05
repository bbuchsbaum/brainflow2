/** Shared FIFO admission for CPU decoding and GPU upload across file loaders. */
export class LoadScheduler {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  private readonly capacity: number;

  constructor(capacity = 2) {
    this.capacity = capacity;
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid load capacity');
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.capacity) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    };
  }
}

export const fileLoadScheduler = new LoadScheduler();
