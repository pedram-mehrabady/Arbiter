# Design system (engineering KB)

Injected into: `design`, `frontend`.

- **Stack:** {{FRONTEND_STACK}}.
- **Shell:** foederata-native 2-bar layout — `TopNav` + `ModuleToolbar` (every module
  uses it). App shell lives in `web/src/features/shell/` (no CB coupling).
- **Styling:** {{UI_LIBRARY}} theming; use the `cn()` utility for all conditional classes;
  never fork shared components — extend them.
- **RTL / Persian:** the UI is Persian-first; respect RTL and existing locale patterns.
- **Reuse:** consume registry components (`<DataTable>`, `FileUpload`, quota popovers,
  …); do not reinvent.

Canonical source: {{WORKSPACE_FE_CLAUDE}} (read on_demand for full FE conventions).
