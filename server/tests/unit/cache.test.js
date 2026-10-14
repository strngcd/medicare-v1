const { cached, markWrite, bumpVersion } = require('../../src/utils/cache');

beforeEach(() => {
  bumpVersion();
  jest.useFakeTimers({ now: new Date('2026-10-14T08:00:00Z') });
});
afterEach(() => jest.useRealTimers());

function counter() {
  let n = 0;
  return () => Promise.resolve((n += 1));
}

test('exact readers never get data from before the latest write', async () => {
  const compute = counter();
  expect(await cached(['k'], compute)).toBe(1);
  expect(await cached(['k'], compute)).toBe(1);
  markWrite();
  expect(await cached(['k'], compute)).toBe(2);
});

test('live readers reuse a result for the staleness window despite writes, then refresh', async () => {
  const compute = counter();
  const live = { maxStaleMs: 15000 };
  expect(await cached(['d'], compute, live)).toBe(1);
  markWrite();
  markWrite();
  jest.advanceTimersByTime(10000);
  expect(await cached(['d'], compute, live)).toBe(1);
  jest.advanceTimersByTime(6000);
  expect(await cached(['d'], compute, live)).toBe(2);
});

test('a reset drops everything, even within the staleness window', async () => {
  const compute = counter();
  await cached(['d'], compute, { maxStaleMs: 15000 });
  bumpVersion();
  expect(await cached(['d'], compute, { maxStaleMs: 15000 })).toBe(2);
});
