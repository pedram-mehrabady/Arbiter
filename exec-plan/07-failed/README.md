# 07-failed — Quarantined (needs human)

Quarantined tasks that the conductor could not recover automatically. Each failed task retains its full artifact folder and error logs (`.arbiter/error-logs/<task-id>/`). A human inspects, fixes or re-scopes the spec, and either moves it back to `01-inbox/` or deletes it. The conductor never auto-retries a dead-lettered task.
