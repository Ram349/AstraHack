// The local game keeps Socket.IO. Sites uses shared room snapshots, allowing
// different Worker instances to see the same racers without a separate server.
export class SitesRaceConnection {
  constructor(status) {
    this.handlers = new Map(); this.connected = true; this.stopped = false; this.status = status;
    this.state = { position: { x: -603.65, y: 47.69, z: 235.15 }, rotation: .1064 };
    this.known = new Set(); this.failures = 0;
    queueMicrotask(() => this.dispatch('connect'));
    addEventListener('pagehide', () => {
      this.stopped = true; clearTimeout(this.timer);
      if (this.session) navigator.sendBeacon('/api/rooms/leave', new Blob([JSON.stringify(this.session)], { type: 'application/json' }));
    });
  }
  on(event, fn) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(fn); }
  dispatch(event, value) { this.handlers.get(event)?.forEach(fn => fn(value)); }
  emit(event, value) {
    if (event === 'state') this.state = value;
    if (event === 'join') { this.room = value; this.join(); }
  }
  async post(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Connection unavailable.'), { status: response.status });
    return data;
  }
  async join() {
    if (this.stopped) return;
    try {
      this.session = await this.post('/api/rooms/join', { room: this.room, state: this.state });
      this.failures = 0; this.status.textContent = `Room ${this.room} · 1 driver`;
      this.timer = setTimeout(() => this.tick(), 220);
    } catch (error) { this.recover(error, true); }
  }
  recover(error, joining = false) {
    this.status.textContent = error.status === 401 ? 'Solo mode · sign in to join friends' : `Solo driving · ${error.message}`;
    if ([401, 403, 409].includes(error.status)) return;
    if (error.status === 410) this.session = null;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.failures++, 4));
    this.timer = setTimeout(() => joining || !this.session ? this.join() : this.tick(), delay);
  }
  async tick() {
    if (this.stopped) return;
    if (document.hidden) { this.timer = setTimeout(() => this.tick(), 1500); return; }
    const started = performance.now();
    try {
      const data = await this.post('/api/rooms/state', { ...this.session, state: this.state });
      const active = new Set(data.players.map(p => p.id));
      for (const id of this.known) if (!active.has(id)) this.dispatch('player-left', { id });
      for (const player of data.players) {
        if (!this.known.has(player.id)) this.dispatch('existing-players', [player]);
        else this.dispatch('state', player);
      }
      this.known = active; this.failures = 0;
      this.status.textContent = `Room ${this.room} · ${active.size + 1} ${active.size ? 'drivers' : 'driver'}`;
      this.timer = setTimeout(() => this.tick(), Math.max(200 - (performance.now() - started), 100));
    } catch (error) { this.recover(error); }
  }
}
