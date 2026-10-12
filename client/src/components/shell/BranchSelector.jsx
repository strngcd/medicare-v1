import { useAuth, ALL_BRANCHES } from '../../context/AuthContext.jsx';

/**
 * Chooses the working branch. Owners can also pick "All branches".
 * Only branches the user is assigned to are offered; the API still checks.
 */
export function BranchSelector() {
  const { activeBranches, canAccessAllBranches, selectedBranchId, selectBranch } = useAuth();
  if (!canAccessAllBranches && activeBranches.length <= 1) {
    const only = activeBranches[0];
    return only ? <span className="badge badge-primary" title="Current branch">{only.name}</span> : null;
  }
  return (
    <select
      className="select branch-select"
      aria-label="Branch"
      value={selectedBranchId || ''}
      onChange={(e) => selectBranch(e.target.value)}
    >
      {canAccessAllBranches && <option value={ALL_BRANCHES}>All branches</option>}
      {activeBranches.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );
}
