# 05-review — Reviewer running, PR open

The reviewer agent runs here, opens a PR, and monitors CI. If `auto_merge: true` in `arbiter.config.json` and all conditions are met (reviewer approved + CI green + no registry duplication + integrator blast-radius clear), the PR is auto-merged. Otherwise the PR stays open for manual merge.
