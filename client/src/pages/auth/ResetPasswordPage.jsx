import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { AuthLayout, AuthBrand } from '../../layouts/AuthLayout.jsx';
import { Button, TextInput, InlineAlert } from '../../components/ui/index.js';
import { passwordProblem } from '../../validators/password.js';

/** Used for both password reset links and new-account setup links. */
export default function ResetPasswordPage({ mode = 'reset' }) {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    const nextErrors = {};
    if (problem) nextErrors.password = problem;
    if (password !== confirm) nextErrors.confirm = 'Passwords do not match.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login', { replace: true, state: { message: 'Your password has been set. Sign in to continue.' } });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const setup = mode === 'setup';
  return (
    <AuthLayout>
      <AuthBrand
        title={setup ? 'Set up your account' : 'Choose a new password'}
        subtitle={setup ? 'Create the password you will use to sign in.' : 'All existing sessions will be signed out.'}
      />
      {!token ? (
        <InlineAlert tone="danger">This link is incomplete. Open the link from your email again, or request a new one.</InlineAlert>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <TextInput label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="At least 8 characters with a letter and a number." />
          <TextInput label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <Button type="submit" size="lg" block loading={loading}>{setup ? 'Create password' : 'Reset password'}</Button>
        </form>
      )}
      <Link to={setup ? '/login' : '/forgot-password'} className="small">{setup ? 'Back to sign in' : 'Request a new link'}</Link>
    </AuthLayout>
  );
}
