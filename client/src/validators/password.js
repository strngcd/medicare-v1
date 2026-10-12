/** Mirrors the server password rule for immediate feedback (the server re-validates). */
export function passwordProblem(password) {
  if (!password || password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Include at least one letter and one number.';
  return null;
}
