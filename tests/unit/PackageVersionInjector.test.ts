import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PackageVersionInjector } from '../../src/context/PackageVersionInjector';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-version-test-'));
}

describe('PackageVersionInjector', () => {
  it('returns empty string when no package files found', async () => {
    const dir = tempDir();
    const injector = new PackageVersionInjector();

    const result = await injector.inject(dir);

    expect(result).toBe('');
  });

  it('correctly parses package.json dependencies', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: { zod: '^3.22.4', express: '4.18.0' },
      devDependencies: { typescript: '~5.0.0' },
    }));
    const injector = new PackageVersionInjector();

    const result = await injector.inject(dir);

    expect(result).toContain('# zod: 3.22.4');
    expect(result).toContain('# express: 4.18.0');
    expect(result).toContain('# typescript: 5.0.0');
  });

  it('strips leading ^ and ~ from versions', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: { lodash: '^4.17.21', axios: '~1.6.0' },
    }));
    const injector = new PackageVersionInjector();

    const result = await injector.inject(dir);

    expect(result).toContain('# lodash: 4.17.21');
    expect(result).toContain('# axios: 1.6.0');
    expect(result).not.toContain('^');
    expect(result).not.toContain('~');
  });

  it('injects versions with correct header format', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: { vitest: '1.0.0' },
    }));
    const injector = new PackageVersionInjector();

    const result = await injector.inject(dir);

    expect(result).toContain('# Package versions in this project (injected by Arbiter):');
    expect(result).toContain('# vitest: 1.0.0');
  });

  it('correctly parses .csproj PackageReference', async () => {
    const dir = tempDir();
    const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Microsoft.EntityFrameworkCore" Version="8.0.0" />
  </ItemGroup>
</Project>`;
    fs.writeFileSync(path.join(dir, 'MyApp.csproj'), csproj);
    const injector = new PackageVersionInjector();

    const result = await injector.inject(dir);

    expect(result).toContain('# Newtonsoft.Json: 13.0.3');
    expect(result).toContain('# Microsoft.EntityFrameworkCore: 8.0.0');
  });

  it('correctly parses requirements.txt', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'requirements.txt'), [
      '# comment',
      'django>=4.2.0',
      'requests==2.31.0',
      'pytest',
    ].join('\n'));
    const injector = new PackageVersionInjector();

    const result = await injector.inject(dir);

    expect(result).toContain('# django: 4.2.0');
    expect(result).toContain('# requests: 2.31.0');
    expect(result).toContain('# pytest: latest');
  });

  it('returns sorted package names', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: { zod: '3.0.0', axios: '1.0.0', react: '18.0.0' },
    }));
    const injector = new PackageVersionInjector();

    const result = await injector.inject(dir);

    const lines = result.split('\n').filter(l => l.startsWith('# ') && l.includes(':'));
    const names = lines.map(l => l.replace('# ', '').split(':')[0].trim());
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});
