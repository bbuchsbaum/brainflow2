import { describe, expect, it } from 'vitest';
import { LoadScheduler } from '../LoadScheduler';

describe('LoadScheduler', () => {
  it('admits loads in FIFO order and retains capacity until the owner releases it', async () => {
    const scheduler = new LoadScheduler(2);
    const first = await scheduler.acquire();
    const second = await scheduler.acquire();
    const order: number[] = [];
    const third = scheduler.acquire().then((release) => {
      order.push(3);
      return release;
    });
    const fourth = scheduler.acquire().then((release) => {
      order.push(4);
      return release;
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    first();
    const releaseThird = await third;
    expect(order).toEqual([3]);
    first(); // Duplicate cleanup must not admit another load.
    await Promise.resolve();
    expect(order).toEqual([3]);
    second();
    (await fourth)();
    releaseThird();
    (await scheduler.acquire())();
    expect(order).toEqual([3, 4]);
  });
});
