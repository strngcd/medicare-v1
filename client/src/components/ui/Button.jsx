export function Button({ variant = 'primary', size, block, loading, icon: Icon, children, disabled, type = 'button', className = '', ...rest }) {
  const classes = ['btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, badge, className = '', ...rest }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon aria-hidden="true" />
      {badge ? <span className="dot-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}
