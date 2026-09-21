import type { PluginButtonRegistration } from "@getpaseo/plugin/client";

interface HeaderButtonHost {
  add(workspaceId: string): PluginButtonRegistration;
}

export class HeaderButtons {
  private readonly registrations = new Map<string, PluginButtonRegistration>();

  constructor(private readonly host: HeaderButtonHost) {}

  reconcile(workspaceIds: Iterable<string>): void {
    const wanted = new Set(workspaceIds);
    for (const [workspaceId, registration] of [...this.registrations]) {
      if (!wanted.has(workspaceId)) {
        registration.remove();
        this.registrations.delete(workspaceId);
      }
    }
    for (const workspaceId of wanted) {
      if (!this.registrations.has(workspaceId)) {
        this.registrations.set(workspaceId, this.host.add(workspaceId));
      }
    }
  }

  clear(): void {
    for (const registration of this.registrations.values()) {
      registration.remove();
    }
    this.registrations.clear();
  }

  get size(): number {
    return this.registrations.size;
  }
}
