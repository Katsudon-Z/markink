import { PLUGIN_API_VERSION, type PluginModule } from './types';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** manifest の検証。問題があれば文言一覧を返す (空＝正常)。 */
export function validateManifest(manifest: PluginModule['manifest']): string[] {
  const errors: string[] = [];
  if (manifest == null || typeof manifest !== 'object') return ['manifest がありません'];
  if (!ID_PATTERN.test(manifest.id ?? '')) errors.push(`不正な id: ${String(manifest.id)}`);
  if (!manifest.name) errors.push('name がありません');
  if (!manifest.version) errors.push('version がありません');
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    errors.push(`apiVersion 非対応: ${String(manifest.apiVersion)} (対応: ${PLUGIN_API_VERSION})`);
  }
  return errors;
}

/** 登録済みプラグインの保管庫。検証・重複・版照合をここで強制する。 */
export class PluginRegistry {
  private modules = new Map<string, PluginModule>();

  register(module: PluginModule): void {
    if (module == null || typeof module.activate !== 'function') {
      throw new Error('activate のないモジュールは登録できません');
    }
    const errors = validateManifest(module.manifest);
    if (errors.length > 0) throw new Error(`manifest 不正 (${errors.join('; ')})`);
    const id = module.manifest.id;
    if (this.modules.has(id)) throw new Error(`重複 id: ${id}`);
    this.modules.set(id, module);
  }

  unregister(id: string): boolean {
    return this.modules.delete(id);
  }

  get(id: string): PluginModule | undefined {
    return this.modules.get(id);
  }

  list(): PluginModule[] {
    return [...this.modules.values()];
  }

  clear(): void {
    this.modules.clear();
  }
}
