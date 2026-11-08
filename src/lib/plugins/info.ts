import type { PluginInfo } from '../ipc';
import type { PluginManifest } from './api';
import { parsePluginManifest } from './manifest';

export function installedManifest(plugin: PluginInfo): PluginManifest {
  return parsePluginManifest(JSON.stringify({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    apiVersion: plugin.apiVersion,
    permissions: plugin.permissions,
    networkOrigins: plugin.networkOrigins,
    settingsFields: plugin.settingsFields,
    fileHashes: plugin.fileHashes,
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.author ? { author: plugin.author } : {}),
    ...(plugin.entry ? { entry: plugin.entry } : {})
  }));
}
