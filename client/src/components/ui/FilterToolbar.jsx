import { Children, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';

/**
 * List filters. On phones only the search field (and the toggle) is shown;
 * the remaining filters open on demand so results stay on the first screen.
 */
export function FilterToolbar({ children }) {
  const [expanded, setExpanded] = useState(false);
  const count = Children.toArray(children).filter(Boolean).length;
  return (
    <div className={`toolbar collapsible ${expanded ? 'expanded' : ''}`}>
      {children}
      {count > 1 && (
        <button type="button" className="btn btn-secondary btn-sm filter-toggle" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          <SlidersHorizontal aria-hidden="true" />
          {expanded ? 'Hide filters' : 'Filters'}
        </button>
      )}
    </div>
  );
}
