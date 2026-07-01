# ADR-008: Remote-Canonical Collaborative Shared Spaces

Collaborative Planning will treat a shared Plan as a remote-canonical Shared Space while it is shared, rather than as an
immutable snapshot or a local-only Plan mirror. The existing Fresh Workspace app will gain a remote SQLite-backed mode
for self-hosted collaboration, while local RunWield Plans enter a hard Shared Plan Lock that blocks normal local
mutation except through collaboration commands. Access uses bearer capabilities instead of accounts: reviewer
capabilities allow encrypted review/comment/resolve flows, maintainer capabilities allow team handoff, pull, push,
close, and destructive unshare, and content encryption keys remain separate from authorization tokens so the server
stores only ciphertext plus minimal routing metadata.

Cloudflare/D1 hosted deployment is intentionally deferred to a separate follow-up Plan after the self-hosted
Fresh/SQLite protocol and Workspace mode are proven.
