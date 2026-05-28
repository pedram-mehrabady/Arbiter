import path from 'node:path';

export const ARBITER_DIR = 'arbiter';
export const ARBITER_STATE_DB = 'arbiter/state.db';
export const ARBITER_TASKS_DIR = 'arbiter/tasks';

const homeDir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~';
export const ADMIN_CONFIG_PATH = path.join(homeDir, '.arbiter', 'admin.config.json');
export const IDENTITY_PATH = path.join(homeDir, '.arbiter', 'identity.json');
