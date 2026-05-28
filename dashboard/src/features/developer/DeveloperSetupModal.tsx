import { useEffect, useState } from 'react';
import { getDeveloperName, setDeveloperName } from '../../lib/developer';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { OsType } from '../../api/types';
import css from './DeveloperSetupModal.module.css';

interface Props {
  onDone: () => void;
  required?: boolean;
}

type RepoMode = 'connect' | 'create';

export function DeveloperSetupModal({ onDone, required = false }: Props) {
  const { settings, updateSettings, connectWithHandle, connectDev, isConnected, setOpenModal } = useAppStore(
    useShallow((s) => ({
      settings:          s.settings,
      updateSettings:    s.updateSettings,
      connectWithHandle: s.connectWithHandle,
      connectDev:        s.connectDev,
      isConnected:       s.isConnected,
      setOpenModal:      s.setOpenModal,
    }))
  );
  const liveApi = useAppStore((s) => s.liveApi);

  const [name, setName]         = useState(getDeveloperName() ?? '');
  const [os, setOs]             = useState<OsType>(settings.os ?? 'mac');
  const [repoMode, setRepoMode] = useState<RepoMode>('connect');

  // connect-existing state
  const [arbiterHandle, setArbiterHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootHandle, setRootHandle]       = useState<FileSystemDirectoryHandle | null>(null);
  const [repoLabel, setRepoLabel]         = useState(settings.repoPath ? settings.repoPath.split('/').pop() ?? '' : '');
  const [pathInput, setPathInput]         = useState(settings.repoPath ?? '');
  const [pathConnecting, setPathConnecting] = useState(false);

  // create-new state
  const [newProjectName, setNewProjectName]     = useState('');
  const [parentHandle, setParentHandle]         = useState<FileSystemDirectoryHandle | null>(null);
  const [parentLabel, setParentLabel]           = useState('');
  const [creating, setCreating]                 = useState(false);

  const [folderError, setFolderError] = useState('');
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);

  useEffect(() => {
    if (required) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onDone(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [required, onDone]);

  // ── Connect existing ────────────────────────────────────────────────────────

  async function pickExistingFolder() {
    setFolderError('');
    if (!window.showDirectoryPicker) {
      setFolderError('Use Chrome, Edge, or Brave — Firefox and Safari cannot open folders.');
      return;
    }
    let picked: FileSystemDirectoryHandle;
    try {
      picked = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setFolderError(`Could not open folder: ${(e as Error).message}`);
      return;
    }

    let arbiter: FileSystemDirectoryHandle;
    let root: FileSystemDirectoryHandle | null = null;

    if (picked.name === '.arbiter') {
      arbiter = picked;
    } else {
      try {
        arbiter = await picked.getDirectoryHandle('.arbiter', { create: false });
        root = picked;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          setFolderError(`Permission denied for "${picked.name}". Grant access when the browser asks.`);
          return;
        } else if (e instanceof DOMException && e.name === 'NotFoundError') {
          // First connect — scaffold .arbiter/ and arbiter.config.json
          try {
            arbiter = await picked.getDirectoryHandle('.arbiter', { create: true });
            const gitkeep = await arbiter.getFileHandle('.gitkeep', { create: true });
            const gw = await gitkeep.createWritable(); await gw.write(''); await gw.close();
            root = picked;
            // Write arbiter.config.json if not present
            try { await picked.getFileHandle('arbiter.config.json', { create: false }); }
            catch {
              const cfgFh = await picked.getFileHandle('arbiter.config.json', { create: true });
              const cw = await cfgFh.createWritable();
              await cw.write(JSON.stringify(buildDefaultArbiterConfig(picked.name), null, 2) + '\n');
              await cw.close();
            }
          } catch (inner) {
            setFolderError(`Could not initialise "${picked.name}": ${(inner as Error).message}`);
            return;
          }
        } else {
          setFolderError(`Could not read "${picked.name}": ${(e as Error).message}`);
          return;
        }
      }
    }

    setArbiterHandle(arbiter);
    setRootHandle(root);
    setRepoLabel(root ? root.name : '.arbiter');
    if (root) updateSettings({ repoPath: root.name });

    try {
      await connectWithHandle(arbiter, root ?? undefined);
      const currentName = getDeveloperName() ?? name.trim();
      if (currentName) {
        const { LiveApi } = await import('../../api/live');
        const api = new LiveApi(arbiter, root ?? undefined);
        await api.writeDeveloperIdentity(currentName).catch(() => {});
      }
      onDone();
      setOpenModal('connect');
    } catch (e) {
      setFolderError(`Connected but error during setup: ${(e as Error).message}`);
    }
  }

  async function connectViaPath() {
    const p = pathInput.trim();
    if (!p) return;
    setPathConnecting(true);
    setFolderError('');
    try {
      await connectDev(p);
      updateSettings({ repoPath: p });
      setRepoLabel(p.split('/').pop() ?? p);
      onDone();
      setOpenModal('connect');
    } catch (e) {
      setFolderError(`Could not connect via path: ${(e as Error).message}`);
    } finally {
      setPathConnecting(false);
    }
  }

  // ── Create new project ──────────────────────────────────────────────────────

  async function pickParentFolder() {
    setFolderError('');
    if (!window.showDirectoryPicker) {
      setFolderError('Use Chrome, Edge, or Brave — Firefox and Safari cannot open folders.');
      return;
    }
    try {
      const picked = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
      setParentHandle(picked);
      setParentLabel(picked.name);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setFolderError(`Could not open folder: ${(e as Error).message}`);
    }
  }

  async function createProject() {
    const projectName = newProjectName.trim();
    if (!projectName || !parentHandle) return;
    setCreating(true);
    setFolderError('');
    try {
      const projectDir = await parentHandle.getDirectoryHandle(projectName, { create: true });
      const arbiterDir = await projectDir.getDirectoryHandle('.arbiter', { create: true });

      // Write .gitkeep so git tracks the directory
      const gitkeep = await arbiterDir.getFileHandle('.gitkeep', { create: true });
      const gw = await gitkeep.createWritable(); await gw.write(''); await gw.close();

      // Write arbiter.config.json with proper format
      const configHandle = await projectDir.getFileHandle('arbiter.config.json', { create: true });
      const writable = await configHandle.createWritable();
      await writable.write(JSON.stringify(buildDefaultArbiterConfig(projectName), null, 2) + '\n');
      await writable.close();

      updateSettings({ repoPath: projectName });
      await connectWithHandle(arbiterDir, projectDir);

      const currentName = getDeveloperName() ?? name.trim();
      if (currentName) {
        const { LiveApi } = await import('../../api/live');
        const api = new LiveApi(arbiterDir, projectDir);
        await api.writeDeveloperIdentity(currentName).catch(() => {});
      }

      onDone();
      setOpenModal('connect');
    } catch (e) {
      setFolderError(`Could not create project: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  // ── Save name/OS ────────────────────────────────────────────────────────────

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setDeveloperName(name.trim());
    updateSettings({ os });
    if (liveApi) {
      try { await liveApi.writeDeveloperIdentity(name.trim()); } catch { /* ignore */ }
    }
    setSaved(true);
    setTimeout(onDone, 600);
  }

  const alreadyConnected = isConnected && !arbiterHandle;
  const btnLabel = saved ? '✓ Saved' : saving ? 'Saving…' : 'Save';
  const canCreate = !!newProjectName.trim() && !!parentHandle;

  return (
    <div className={css.overlay} onClick={!required ? onDone : undefined}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        {!required && (
          <button className={css.closeBtn} onClick={onDone} aria-label="Close">✕</button>
        )}

        <div className={css.icon}>⚙</div>
        <div className={css.title}>{getDeveloperName() ? 'Settings' : 'Set up Arbiter'}</div>
        <div className={css.sub}>Saved locally on your machine — never committed to git.</div>

        <form onSubmit={submit}>
          <div className={css.label}>Your name</div>
          <input
            className={css.input}
            type="text"
            placeholder="e.g. Pedram"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            autoFocus
          />

          <div className={css.label}>Operating system</div>
          <div className={css.osToggle}>
            {(['mac', 'win'] as OsType[]).map((o) => (
              <button
                key={o}
                type="button"
                className={`${css.osBtn}${os === o ? ' ' + css.osBtnActive : ''}`}
                onClick={() => setOs(o)}
              >
                {o === 'mac' ? '🍎 Mac' : '🪟 Windows'}
              </button>
            ))}
          </div>

          {/* ── Repo section ── */}
          <div className={css.label}>Repository</div>

          <div className={css.modeToggle}>
            <button
              type="button"
              className={`${css.modeBtn}${repoMode === 'connect' ? ' ' + css.modeBtnActive : ''}`}
              onClick={() => { setRepoMode('connect'); setFolderError(''); }}
            >
              📁 Connect existing
            </button>
            <button
              type="button"
              className={`${css.modeBtn}${repoMode === 'create' ? ' ' + css.modeBtnActive : ''}`}
              onClick={() => { setRepoMode('create'); setFolderError(''); }}
            >
              ✨ Create new
            </button>
          </div>

          {repoMode === 'connect' && (
            <div className={css.modeBody}>
              <div className={css.folderRow}>
                <button type="button" className={css.folderBtn} onClick={pickExistingFolder}>
                  📁 {arbiterHandle ? 'Change folder' : alreadyConnected ? 'Change folder' : 'Select folder'}
                </button>
                {(repoLabel || alreadyConnected) && (
                  <span className={css.folderPath}>
                    <span className={css.folderCheck}>✓</span>
                    {repoLabel || settings.repoPath}
                  </span>
                )}
              </div>
              {!folderError && !arbiterHandle && !alreadyConnected && (
                <div className={css.folderHint}>
                  Pick your project root — Arbiter will create a <code>.arbiter</code> folder if one doesn't exist yet.
                </div>
              )}
              <div className={css.pathOr}>— or connect via path —</div>
              <div className={css.pathRow}>
                <input
                  className={css.pathInput}
                  type="text"
                  placeholder="/Users/you/my-project"
                  value={pathInput}
                  onChange={(e) => { setPathInput(e.target.value); setFolderError(''); }}
                />
                <button
                  type="button"
                  className={css.pathBtn}
                  onClick={connectViaPath}
                  disabled={!pathInput.trim() || pathConnecting}
                >
                  {pathConnecting ? '…' : 'Connect'}
                </button>
              </div>
            </div>
          )}

          {repoMode === 'create' && (
            <div className={css.modeBody}>
              <div className={css.createForm}>
                <label className={css.createLabel}>Project name</label>
                <input
                  className={css.input}
                  type="text"
                  placeholder="my-project"
                  value={newProjectName}
                  onChange={(e) => { setNewProjectName(e.target.value); setFolderError(''); }}
                />
                <label className={css.createLabel} style={{ marginTop: 12 }}>Where to create it</label>
                <div className={css.folderRow}>
                  <button type="button" className={css.folderBtn} onClick={pickParentFolder}>
                    📁 {parentHandle ? 'Change location' : 'Pick location'}
                  </button>
                  {parentLabel && (
                    <span className={css.folderPath}>
                      <span className={css.folderCheck}>✓</span>
                      {parentLabel}{newProjectName.trim() ? `/${newProjectName.trim()}` : ''}
                    </span>
                  )}
                </div>
                {!folderError && !parentHandle && (
                  <div className={css.folderHint}>
                    Pick the parent folder — Arbiter will create <code>{newProjectName.trim() || 'my-project'}/</code> inside it.
                  </div>
                )}
                <button
                  type="button"
                  className={css.createBtn}
                  onClick={createProject}
                  disabled={!canCreate || creating}
                >
                  {creating ? 'Creating…' : '✨ Create project'}
                </button>
              </div>
            </div>
          )}

          {folderError && <div className={css.folderError}>{folderError}</div>}

          <button
            className={css.btn}
            type="submit"
            disabled={!name.trim() || saving || saved}
          >
            {btnLabel}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Scaffold helpers ──────────────────────────────────────────────────────────

function buildDefaultArbiterConfig(projectName: string): object {
  const cli = 'claude_max_cli';
  const opus   = 'claude-opus-4-7';
  const sonnet = 'claude-sonnet-4-6';
  const haiku  = 'claude-haiku-4-5-20251001';
  return {
    auto_merge: false,
    gates: { design: true, plan: true, review: true },
    template_vars: { PROJECT_NAME: projectName },
    providers: {
      claude_max_cli: { cmd: 'claude', headless_flag: '-p' },
    },
    roles: {
      reframe:         { provider: cli, model: sonnet },
      research:        { provider: cli, model: sonnet },
      design:          { provider: cli, model: sonnet },
      'design-critic': { provider: cli, model: haiku  },
      integrator:      { provider: cli, model: opus   },
      plan:            { provider: cli, model: opus   },
      frontend:        { provider: cli, model: sonnet },
      backend:         { provider: cli, model: sonnet },
      'test-writer':   { provider: cli, model: haiku  },
      reviewer:        { provider: cli, model: opus   },
      'tech-writer':   { provider: cli, model: sonnet },
      debugger:        { provider: cli, model: opus   },
    },
  };
}
