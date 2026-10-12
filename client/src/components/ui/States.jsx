import { Link } from 'react-router-dom';
import { AlertTriangle, Inbox, Lock, SearchX, BookOpen, RefreshCw } from 'lucide-react';
import { Button } from './Button.jsx';

export function Skeleton({ width = '100%', height = 14, style }) {
  return <span className="skeleton" style={{ width, height, ...style }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5, columns = 4 }) {
  return (
    <div className="stack-sm" style={{ padding: 16 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="row" style={{ gap: 16 }}>
          {Array.from({ length: columns }, (_, c) => <Skeleton key={c} width={`${100 / columns}%`} />)}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, message, action, learnHow }) {
  return (
    <div className="state">
      <Icon className="state-icon" aria-hidden="true" />
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {(action || learnHow) && (
        <div className="state-actions">
          {action}
          {learnHow && <LearnHow slug={learnHow} />}
        </div>
      )}
    </div>
  );
}

/** Shown when filters/search exclude everything (distinct from "no data yet"). */
export function FilteredEmpty({ onClear, isSearch }) {
  return (
    <EmptyState
      icon={SearchX}
      title={isSearch ? 'No matches' : 'No results for these filters'}
      message={isSearch ? 'Try a different search term.' : 'Adjust or clear the filters to see more records.'}
      action={onClear && <Button variant="secondary" onClick={onClear}>Clear filters</Button>}
    />
  );
}

export function ErrorState({ error, onRetry }) {
  if (error && error.status === 403) return <Unauthorized />;
  return (
    <div className="state">
      <AlertTriangle className="state-icon" aria-hidden="true" />
      <h3>{error && error.status === 404 ? 'Not found' : 'Could not load this information'}</h3>
      <p>{error ? error.message : 'Please try again.'}</p>
      {onRetry && error && error.status !== 404 && (
        <Button variant="secondary" icon={RefreshCw} onClick={() => onRetry()}>Try again</Button>
      )}
    </div>
  );
}

export function Unauthorized() {
  return (
    <div className="state">
      <Lock className="state-icon" aria-hidden="true" />
      <h3>You do not have access</h3>
      <p>Your role or branch assignment does not include this area. Ask an Owner or Admin if you need access.</p>
      <LearnHow slug="roles-and-permissions" />
    </div>
  );
}

export function LearnHow({ slug, label = 'Learn how this works' }) {
  return (
    <Link className="btn btn-ghost btn-sm" to={`/help/${slug}`}>
      <BookOpen aria-hidden="true" />
      {label}
    </Link>
  );
}

export function InlineAlert({ tone = 'info', icon: Icon = AlertTriangle, children }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <div className="grow">{children}</div>
    </div>
  );
}
