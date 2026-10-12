import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { AuthLayout, AuthBrand } from '../../layouts/AuthLayout.jsx';
import { Button, Field, InlineAlert } from '../../components/ui/index.js';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      const target = location.state && location.state.from ? location.state.from : '/';
      navigate(target, { replace: true });
    } catch (err) {
      // Server messages for auth failures are deliberately generic.
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthBrand title="Sign in" subtitle="Use your work email and password." />
      {location.state && location.state.message && <InlineAlert tone="success">{location.state.message}</InlineAlert>}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email" htmlFor="email">
          <div className="input-with-icon">
            <Mail aria-hidden="true" />
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
        </Field>
        <Field label="Password" htmlFor="password">
          <div className="input-with-icon">
            <Lock aria-hidden="true" />
            <input
              id="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              className="icon-btn input-action"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
        </Field>
        <Button type="submit" size="lg" block loading={loading}>Sign in</Button>
      </form>
      <Link to="/forgot-password" className="small">Forgot your password?</Link>
    </AuthLayout>
  );
}
