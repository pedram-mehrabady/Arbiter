const NAME_KEY = 'arbiter-dev-name';;

export function getDeveloperName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function setDeveloperName(name: string) {
  localStorage.setItem(NAME_KEY, name.trim());
}

/** Write { name } to arbiter/developer-identity.json so shell scripts can read it. */
export async function writeDeveloperIdentityFile(
  name: string,
  arbiterDir: FileSystemDirectoryHandle,
): Promise<void> {
  const fh = await arbiterDir.getFileHandle('developer-identity.json', { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify({ name: name.trim() }, null, 2));
  await writable.close();
}
