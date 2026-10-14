import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuantityInput } from './QuantityInput.jsx';

function Harness({ available = 20, onTooMany = () => {} }) {
  const [quantity, setQuantity] = useState(1);
  return (
    <>
      <QuantityInput line={{ name: 'Paracetamol', quantity, available }} onChange={setQuantity} onTooMany={onTooMany} />
      <span data-testid="qty">{quantity}</span>
    </>
  );
}

test('typed quantities are kept while typing and applied when valid', () => {
  render(<Harness />);
  const input = screen.getByLabelText('Quantity of Paracetamol');
  fireEvent.change(input, { target: { value: '' } });
  expect(input.value).toBe('');
  fireEvent.change(input, { target: { value: '1' } });
  fireEvent.change(input, { target: { value: '12' } });
  expect(input.value).toBe('12');
  expect(screen.getByTestId('qty').textContent).toBe('12');
});

test('too many units are capped to stock when leaving the box', () => {
  const onTooMany = jest.fn();
  render(<Harness available={5} onTooMany={onTooMany} />);
  const input = screen.getByLabelText('Quantity of Paracetamol');
  fireEvent.change(input, { target: { value: '9' } });
  expect(screen.getByTestId('qty').textContent).toBe('1');
  fireEvent.blur(input);
  expect(onTooMany).toHaveBeenCalled();
  expect(input.value).toBe('5');
  expect(screen.getByTestId('qty').textContent).toBe('5');
});

test('an empty box goes back to the current quantity', () => {
  render(<Harness />);
  const input = screen.getByLabelText('Quantity of Paracetamol');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
  expect(input.value).toBe('1');
});
