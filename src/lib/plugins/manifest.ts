import { EXTENSION_API_VERSION, type PluginManifest, type PluginPermission } from './api';

const PERMISSIONS = new Set<PluginPermission>([
  'document.read',
  'document.edit',
  'ui.register',
  'ui.notify',
  'ui.dialog',
  'log.write',
  'settings.read',
  'settings.write',
  'network.request',
  'secrets.use'
]);
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

function parseOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error('manifest の networkOrigins が不正です。');
  }
  const origins = value.map((item) => {
    if (typeof item !== 'string' || item.length > 256) {
      throw new Error('manifest の通信先が不正です。');
    }
    let url: URL;
    try { url = new URL(item); } catch { throw new Error('manifest の通信先URLが不正です。'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.origin !== item
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error('manifest の通信先は http(s) の origin を指定してください。');
    }
    return item;
  });
  if (new Set(origins).size !== origins.length) {
    throw new Error('manifest の通信先に重複があります。');
  }
  return origins;
}

function parseSettingsFields(value: unknown): NonNullable<PluginManifest['settingsFields']> {
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error('manifest の settingsFields が不正です。');
  }
  const fields = value.map((item) => {
    if (!record(item) || typeof item.key !== 'string'
      || !/^[a-zA-Z0-9._-]{1,64}$/.test(item.key) || item.key === '.' || item.key === '..'
      || !['text', 'number', 'choice'].includes(String(item.type))) {
      throw new Error('manifest の設定項目が不正です。');
    }
    const label = requiredString(item.label, 'settingsFields.label', 120);
    const defaultValue = item.defaultValue === undefined ? undefined
      : requiredString(item.defaultValue, 'settingsFields.defaultValue', 4096);
    let options: string[] | undefined;
    if (item.type === 'choice') {
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 8) {
        throw new Error('選択式設定の候補が不正です。');
      }
      options = item.options.map((option) => requiredString(option, 'settingsFields.options', 120));
      if (new Set(options).size !== options.length || (defaultValue && !options.includes(defaultValue))) {
        throw new Error('選択式設定の既定値または候補が不正です。');
      }
    } else if (item.options !== undefined) {
      throw new Error('選択式以外の設定に候補は指定できません。');
    }
    if (item.type === 'number' && defaultValue !== undefined && !Number.isFinite(Number(defaultValue))) {
      throw new Error('数値設定の既定値が不正です。');
    }
    return {
      key: item.key, label, type: item.type as 'text' | 'number' | 'choice',
      ...(defaultValue === undefined ? {} : { defaultValue }),
      ...(options === undefined ? {} : { options })
    };
  });
  if (new Set(fields.map((field) => field.key)).size !== fields.length) {
    throw new Error('設定キーが重複しています。');
  }
  return fields;
}

function parseFileHashes(value: unknown): Record<string, string> {
  if (!record(value) || Object.keys(value).length > 256) {
    throw new Error('manifest の fileHashes が不正です。');
  }
  const hashes: Record<string, string> = Object.create(null);
  const paths = new Set<string>();
  for (const [path, digest] of Object.entries(value)) {
    if (!path || path === 'manifest.json' || path.length > 240 || path.includes('\\')
      || path.startsWith('/') || /^[a-zA-Z]:/.test(path)
      || path.split('/').some((part) => !part || part === '.' || part === '..')
      || paths.has(path.toLowerCase())
      || typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error('manifest のファイルハッシュが不正です。');
    }
    paths.add(path.toLowerCase());
    hashes[path] = digest;
  }
  return hashes;
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
    ...(value.networkOrigins === undefined ? {} : { networkOrigins: parseOrigins(value.networkOrigins) }),
    ...(value.settingsFields === undefined ? {} : { settingsFields: parseSettingsFields(value.settingsFields) }),
    ...(value.fileHashes === undefined ? {} : { fileHashes: parseFileHashes(value.fileHashes) }),
    ...(value.description === undefined
      ? {}
      : { description: requiredString(value.description, 'description', 2000) }),
    ...(value.author === undefined ? {} : { author: requiredString(value.author, 'author', 120) }),
    ...(safeEntry(value.entry) ? { entry: safeEntry(value.entry) } : {})
  };
  if (manifest.settingsFields?.length
    && (!permissions.includes('settings.read') || !permissions.includes('settings.write'))) {
    throw new Error('設定項目には settings.read と settings.write 権限が必要です。');
  }
  return manifest;
}
