import { EXTENSION_API_VERSION, type PluginManifest, type PluginPermission } from './api';

const PERMISSIONS = new Set<PluginPermission>([
  'document.read',
  'document.edit',
  'ui.register',
  'ui.notify',
  'log.write'
]);
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`manifest の ${field} が不正です。`);
  }
  return value.trim();
}

function safeEntry(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const entry = requiredString(value, 'entry', 240).replaceAll('\\', '/');
  if (
    entry.startsWith('/') ||
    /^[a-zA-Z]:/.test(entry) ||
    entry.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error('manifest の entry はプラグイン内の相対パスで指定してください。');
  }
  return entry;
}

export function parsePluginManifest(source: string): PluginManifest {
  if (new TextEncoder().encode(source).byteLength > 64 * 1024) {
    throw new Error('manifest.json が大きすぎます。');
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('manifest.json を JSON として読み取れません。');
  }
  if (!record(value)) throw new Error('manifest.json の形式が不正です。');

  const id = requiredString(value.id, 'id', 64);
  if (!PLUGIN_ID.test(id)) throw new Error('manifest の id の形式が不正です。');
  const version = requiredString(value.version, 'version', 80);
  if (!SEMVER.test(version)) throw new Error('manifest の version は SemVer 形式で指定してください。');
  if (value.apiVersion !== EXTENSION_API_VERSION) {
    throw new Error(`未対応の Extension API バージョンです: ${String(value.apiVersion)}`);
  }
  if (!Array.isArray(value.permissions) || value.permissions.length > PERMISSIONS.size) {
    throw new Error('manifest の permissions が不正です。');
  }
  const permissions = value.permissions.map((permission) => {
    if (typeof permission !== 'string' || !PERMISSIONS.has(permission as PluginPermission)) {
      throw new Error(`未対応のプラグイン権限です: ${String(permission)}`);
    }
    return permission as PluginPermission;
  });
  if (new Set(permissions).size !== permissions.length) {
    throw new Error('manifest の permissions に重複があります。');
  }

  const manifest: PluginManifest = {
    id,
    name: requiredString(value.name, 'name', 120),
    version,
    apiVersion: EXTENSION_API_VERSION,
    permissions,
    ...(value.description === undefined
      ? {}
      : { description: requiredString(value.description, 'description', 2000) }),
    ...(value.author === undefined ? {} : { author: requiredString(value.author, 'author', 120) }),
    ...(safeEntry(value.entry) ? { entry: safeEntry(value.entry) } : {})
  };
  return manifest;
}
