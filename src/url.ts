// URL detection for `marshal bind <target>`. Distinguishes git-clonable URLs
// from local filesystem paths. Conservative on purpose — Windows paths can
// look exotic (drive letters, UNC, mixed slashes) so we ONLY treat strings
// with a recognized scheme prefix as URLs.
//
// Recognized URL prefixes: http://, https://, ssh://, git://, file://, git@host:
// Everything else is a path.

const URL_SCHEME_RE = /^(https?|ssh|git|file):\/\//i;
const SSH_SHORTHAND_RE = /^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:/;

export function isUrl(target: string): boolean {
  if (URL_SCHEME_RE.test(target)) {
    return true;
  }
  if (SSH_SHORTHAND_RE.test(target)) {
    return true;
  }
  return false;
}
