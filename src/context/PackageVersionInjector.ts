import fs from 'node:fs/promises';
import path from 'node:path';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export class PackageVersionInjector {
  async inject(workspaceRoot: string): Promise<string> {
    const versions: Record<string, string> = {};

    await Promise.all([
      this.readPackageJson(workspaceRoot, versions),
      this.readCsprojFiles(workspaceRoot, versions),
      this.readRequirementsTxt(workspaceRoot, versions),
    ]);

    if (Object.keys(versions).length === 0) return '';

    const lines = ['# Package versions in this project (injected by Arbiter):'];
    for (const [pkg, version] of Object.entries(versions).sort()) {
      lines.push(`# ${pkg}: ${version}`);
    }
    lines.push('');

    return lines.join('\n');
  }

  private async readPackageJson(workspaceRoot: string, versions: Record<string, string>): Promise<void> {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content) as PackageJson;
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, version] of Object.entries(allDeps)) {
        versions[name] = version.replace(/^[\^~>=<]/, '');
      }
    } catch {
      // No package.json — skip
    }
  }

  private async readCsprojFiles(workspaceRoot: string, versions: Record<string, string>): Promise<void> {
    const csprojFiles = await findFilesWithExtension(workspaceRoot, '.csproj');
    for (const filePath of csprojFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const re = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
          versions[match[1]] = match[2];
        }
      } catch { /* Skip unreadable file */ }
    }
  }

  private async readRequirementsTxt(workspaceRoot: string, versions: Record<string, string>): Promise<void> {
    const reqFiles = await findFilesWithExtension(workspaceRoot, 'requirements.txt');
    for (const filePath of reqFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([a-zA-Z0-9_.-]+)[>=<~!]+([^\s;]+)/);
          if (match) {
            versions[match[1]] = match[2];
          } else if (/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
            versions[trimmed] = 'latest';
          }
        }
      } catch { /* Skip unreadable file */ }
    }
  }
}

async function findFilesWithExtension(dir: string, ext: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await findFilesWithExtension(fullPath, ext));
      } else if (entry.name.endsWith(ext)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory unreadable
  }
  return results;
}
