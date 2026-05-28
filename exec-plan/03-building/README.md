# 03-building — Code generation in progress

Code generation runs here. The frontend agent runs first; if `ui_first: true`, the task pauses at `04-human-gate/` for visual approval before the backend agent continues. After all coders and the test-writer finish, the conductor moves the task to `05-review/`.
