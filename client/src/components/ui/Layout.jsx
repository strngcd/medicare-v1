import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export function PageHeader({ title, description, breadcrumbs, actions }) {
  return (
    <div className="page-header">
      <div className="page-title">
        {breadcrumbs && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {breadcrumbs.map((b, i) => (
              <span key={b.label} className="row" style={{ gap: 6 }}>
                {b.to ? <Link to={b.to}>{b.label}</Link> : <span>{b.label}</span>}
                {i < breadcrumbs.length - 1 && <ChevronRight size={12} aria-hidden="true" />}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, footer, flush, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row-wrap">{actions}</div>}
        </header>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
      {footer && <footer className="panel-footer">{footer}</footer>}
    </section>
  );
}

export function Details({ items }) {
  return (
    <dl className="details">
      {items.filter(Boolean).map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value === null || item.value === undefined || item.value === '' ? '—' : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Kpi({ label, value, note, icon: Icon, tone, onClick, loading }) {
  return (
    <div
      className={`kpi ${tone ? `tone-${tone}` : ''} ${onClick ? 'is-link' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && onClick()}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="kpi-label">{Icon && <Icon aria-hidden="true" />}{label}</span>
      {loading ? <span className="skeleton" style={{ height: 26, width: '60%' }} /> : <span className="kpi-value">{value}</span>}
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={active === t.value}
          className={`tab ${active === t.value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Steps({ steps, current }) {
  const index = steps.findIndex((s) => s.value === current);
  return (
    <ol className="steps" aria-label="Progress" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((s, i) => {
        const state = i < index ? 'done' : i === index ? 'current' : '';
        return (
          <li key={s.value} className={`step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot">{i + 1}</span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
