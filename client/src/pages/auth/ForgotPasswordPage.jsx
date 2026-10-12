import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { AuthLayout, AuthBrand } from '../../layouts/AuthLayout.jsx';
import { Button, TextInput, InlineAlert } from '../../components/ui/index.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err.status === 422 ? 'Enter a valid email address.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthBrand title="Reset your password" subtitle="We will send a single-use reset link if the email belongs to an active account." />
      {sent ? (
        <InlineAlert tone="success">If an active account uses that email, a reset link is on its way. The link expires and can be used once.</InlineAlert>
      ) : (
        <form className="stack" onSubmit={submit}>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <Button type="submit" size="lg" block loading={loading}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="small">Back to sign in</Link>
    </AuthLayout>
  );
}
