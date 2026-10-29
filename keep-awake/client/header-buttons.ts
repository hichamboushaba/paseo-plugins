import type { PluginButtonRegistration } from "@getpaseo/plugin/client";

interface HeaderButtonHost {
  add(workspaceId: string): PluginButtonRegistration;
}

// A closure, not a class: the mobile app's Hermes engine can't compile class syntax in plugin bundles.
export function createHeaderButtons(host: HeaderButtonHost): {
  reconcile(workspaceIds: Iterable<string>): void;
  clear(): void;
  readonly size: number;
} {
  const registrations = new Map<string, PluginButtonRegistration>();

  return {
    reconcile(workspaceIds: Iterable<string>): void {
      const wanted = new Set(workspaceIds);
      for (const [workspaceId, registration] of [...registrations]) {
        if (!wanted.has(workspaceId)) {
          registration.remove();
          registrations.delete(workspaceId);
        }
      }
      for (const workspaceId of wanted) {
        if (!registrations.has(workspaceId)) {
          registrations.set(workspaceId, host.add(workspaceId));
        }
      }
    },

    clear(): void {
      for (const registration of registrations.values()) {
        registration.remove();
      }
      registrations.clear();
    },

    get size(): number {
      return registrations.size;
    },
  };
}
