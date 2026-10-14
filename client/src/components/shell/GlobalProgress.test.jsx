import { act, render, screen } from '@testing-library/react';
import { GlobalProgress } from './GlobalProgress.jsx';
import { api } from '../../api/client.js';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  delete global.fetch;
});

test('shows nothing for quick requests, a bar and then a spinner for slow ones', async () => {
  let resolve;
  global.fetch = jest.fn(() => new Promise((r) => { resolve = r; }));
  render(<GlobalProgress />);

  let call;
  act(() => { call = api.get('/slow').catch(() => {}); });
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

  act(() => { jest.advanceTimersByTime(250); });
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

  act(() => { jest.advanceTimersByTime(600); });
  expect(screen.getByText('Loading…')).toBeInTheDocument();

  await act(async () => {
    resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data: {} }) });
    await call;
  });
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
