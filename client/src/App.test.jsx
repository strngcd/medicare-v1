import { render, screen } from '@testing-library/react';
import App from './App.jsx';

test('renders the application name', () => {
  render(<App />);
  expect(screen.getByText('Medicar Pharmacy')).toBeInTheDocument();
});
