import type { PluginCommand, PluginId } from './api';

export interface RegisteredCommand {
  key: string;
  pluginId: PluginId;
  command: PluginCommand;
  run: () => void | Promise<void>;
}

export class PluginCommandRegistry {
  private readonly commands = new Map<string, RegisteredCommand>();
  private snapshot: RegisteredCommand[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RegisteredCommand[] => this.snapshot;

  register(pluginId: PluginId, command: PluginCommand, run: () => void | Promise<void>): () => void {
    const key = `${pluginId}:${command.id}`;
    if (this.commands.has(key)) throw new Error(`コマンドが重複しています: ${key}`);
    const registered = { key, pluginId, command: { ...command }, run };
    this.commands.set(key, registered);
    this.publish();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.commands.get(key) === registered) {
        this.commands.delete(key);
        this.publish();
      }
    };
  }

  private publish(): void {
    this.snapshot = [...this.commands.values()].sort((a, b) =>
      a.command.title.localeCompare(b.command.title, 'ja')
    );
    for (const listener of this.listeners) listener();
  }
}

