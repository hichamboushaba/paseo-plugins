export class HoldTracker {
  private readonly held = new Set<string>();

  add(agentId: string): boolean {
    if (this.held.has(agentId)) {
      return false;
    }
    this.held.add(agentId);
    return true;
  }

  remove(agentId: string): boolean {
    return this.held.delete(agentId);
  }

  // `skipDrops` lets a caller apply a snapshot it knows may be stale: a running agent it hasn't
  // seen yet is always safe to add (it only over-holds), but dropping a held agent on a stale
  // snapshot can release a hold for a turn that is still live. Skipping drops means `dropped` is
  // always `[]` here -- there is nothing else for it to report.
  reconcile(runningAgentIds: Iterable<string>, skipDrops = false): { added: string[]; dropped: string[] } {
    const running = new Set(runningAgentIds);
    const dropped: string[] = [];
    if (!skipDrops) {
      for (const agentId of this.held) {
        if (!running.has(agentId)) {
          dropped.push(agentId);
        }
      }
      for (const agentId of dropped) {
        this.held.delete(agentId);
      }
    }
    const added: string[] = [];
    for (const agentId of running) {
      if (!this.held.has(agentId)) {
        this.held.add(agentId);
        added.push(agentId);
      }
    }
    return { added, dropped };
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
