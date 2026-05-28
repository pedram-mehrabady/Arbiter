# 04-human-gate — Awaiting human approval

The pipeline is paused here waiting for human approval. Two possible gates: (1) **schema gate** — human approves the DB schema diff before the backend agent runs; (2) **UI gate** — human visually approves the rendered UI before backend continues. Approve or reject via `arbiter approve <id> schema|ui` or the dashboard gate card.
