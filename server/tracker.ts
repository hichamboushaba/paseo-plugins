export class HoldTracker {
  private readonly held = new Set<string>();

  add(agentId: string): void {
    this.held.add(agentId);
  }

  remove(agentId: string): void {
    this.held.delete(agentId);
  }

  reconcile(runningAgentIds: Iterable<string>): string[] {
    const running = new Set(runningAgentIds);
    const dropped: string[] = [];
    for (const agentId of this.held) {
      if (!running.has(agentId)) {
        dropped.push(agentId);
      }
    }
    for (const agentId of dropped) {
      this.held.delete(agentId);
    }
    return dropped;
  }

  clear(): void {
    this.held.clear();
  }

  get holding(): boolean {
    return this.held.size > 0;
  }

  ids(): string[] {
    return [...this.held];
  }
}
