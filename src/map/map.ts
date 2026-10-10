import { boundsOf, fitView, MAX_ZOOM, MIN_ZOOM, project, TILE, unproject } from './geo.ts';
import type { LatLon } from './geo.ts';

export interface MapLine {
  points: LatLon[];
  color: string;
  width: number;
  /** приглушённая линия (остальная часть маршрута) */
  dim?: boolean;
}

export interface MapMarker extends LatLon {
  id: string;
  name: string;
  code: string;
  /** 'from' / 'to' — посадка и выход, 'end' — конечные, 'stop' — обычные */
  kind: 'from' | 'to' | 'end' | 'stop';
  color: string;
}

export interface MapOptions {
  tiles: boolean;
  tileUrl: string;
  onMarker: (m: MapMarker | null) => void;
}

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const css = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Небольшая карта на canvas: плитки (по желанию) + линии маршрута + остановки. Без внешних библиотек. */
export class TransitMap {
  readonly el: HTMLElement;
  private tileCanvas = document.createElement('canvas');
  private overlay = document.createElement('canvas');
  private lines: MapLine[] = [];
  private markers: MapMarker[] = [];
  private center: LatLon = { lat: 44.8125, lon: 20.4612 };
  private zoom = 12;
  private w = 300;
  private h = 300;
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private tiles = new Map<string, HTMLImageElement | 'err'>();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  private moved = 0;
  private ro: ResizeObserver;
  private opts: MapOptions;
  private selected: string | null = null;
  private lastTap = 0;

  constructor(opts: MapOptions) {
    this.opts = opts;
    this.el = document.createElement('div');
    this.el.className = 'map';
    this.tileCanvas.className = 'map-tiles';
    this.overlay.className = 'map-overlay';
    this.el.append(this.tileCanvas, this.overlay);
    this.overlay.addEventListener('pointerdown', this.onDown);
    this.overlay.addEventListener('pointermove', this.onMove);
    this.overlay.addEventListener('pointerup', this.onUp);
    this.overlay.addEventListener('pointercancel', this.onCancel);
    this.overlay.addEventListener('wheel', this.onWheel, { passive: false });
    this.el.classList.toggle('has-tiles', opts.tiles);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.resize();
  }

  destroy(): void {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  setTiles(on: boolean): void {
    this.opts.tiles = on;
    this.el.classList.toggle('has-tiles', on);
    this.invalidate();
  }

  setData(lines: MapLine[], markers: MapMarker[]): void {
    this.lines = lines;
    this.markers = markers;
    this.selected = null;
    this.fit();
  }

  fit(): void {
    const pts: LatLon[] = [...this.markers, ...this.lines.filter((l) => !l.dim).flatMap((l) => l.points)];
    const all = pts.length ? pts : this.lines.flatMap((l) => l.points);
    const b = boundsOf(all.filter((p) => p.lat !== 0 || p.lon !== 0));
    if (!b) return;
    const v = fitView(b, this.w, this.h, 44);
    this.center = v.center;
    this.zoom = v.zoom;
    this.invalidate();
  }

  zoomBy(dz: number, anchor?: { x: number; y: number }): void {
    const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom + dz));
    if (nz === this.zoom) return;
    const a = anchor ?? { x: this.w / 2, y: this.h / 2 };
    const c = project(this.center.lat, this.center.lon, this.zoom);
    const ll = unproject(c.x + (a.x - this.w / 2), c.y + (a.y - this.h / 2), this.zoom);
    this.zoom = nz;
    const p = project(ll.lat, ll.lon, nz);
    this.center = unproject(p.x - (a.x - this.w / 2), p.y - (a.y - this.h / 2), nz);
    this.invalidate();
  }

  select(id: string | null): void {
    this.selected = id;
    this.invalidate();
  }

  // ---------- ввод

  private pos(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent): void => {
    this.overlay.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.pos(e));
    if (this.pointers.size === 1) this.moved = 0;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom };
    }
  };

  private onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = this.pos(e);
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      this.moved += Math.abs(dx) + Math.abs(dy);
      const c = project(this.center.lat, this.center.lon, this.zoom);
      this.center = unproject(c.x - dx, c.y - dy, this.zoom);
      this.invalidate();
    } else if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const target = this.pinch.zoom + Math.log2(dist / this.pinch.dist);
      this.moved += 10;
      this.zoomBy(target - this.zoom, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (p && this.pointers.size === 0 && this.moved < 8) this.tap(p);
  };

  private onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.pinch = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoomBy(-Math.sign(e.deltaY) * 0.5, this.pos(e));
  };

  private tap(p: { x: number; y: number }): void {
    const now = Date.now();
    if (now - this.lastTap < 300) {
      this.zoomBy(1, p);
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
    const c = project(this.center.lat, this.center.lon, this.zoom);
    let best: MapMarker | null = null;
    let bd = 22 * 22;
    for (const m of this.markers) {
      const q = project(m.lat, m.lon, this.zoom);
      const sx = q.x - c.x + this.w / 2;
      const sy = q.y - c.y + this.h / 2;
      const d = (sx - p.x) ** 2 + (sy - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    this.selected = best ? best.id : null;
    this.invalidate();
    this.opts.onMarker(best);
  }

  // ---------- отрисовка

  private resize(): void {
    const r = this.el.getBoundingClientRect();
    this.w = Math.max(50, Math.round(r.width));
    this.h = Math.max(50, Math.round(r.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.tileCanvas, this.overlay]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this.invalidate();
  }

  invalidate(): void {
    if (this.dirty && this.raf) return;
    this.dirty = true;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private draw(): void {
    this.dirty = false;
    this.drawTiles();
    this.drawOverlay();
  }

  private drawTiles(): void {
    const ctx = this.tileCanvas.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h); // фон рисует CSS (.mapbox), чтобы тёмный фильтр плиток его не инвертировал
    if (!this.opts.tiles) {
      this.drawGrid(ctx);
      return;
    }
    const z0 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(this.zoom + 0.25)));
    const scale = Math.pow(2, this.zoom - z0);
    const size = TILE * scale;
    const c = project(this.center.lat, this.center.lon, z0);
    const cx = c.x * scale;
    const cy = c.y * scale;
    const left = cx - this.w / 2;
    const top = cy - this.h / 2;
    const n = Math.pow(2, z0);
    const tx0 = Math.floor(left / size);
    const tx1 = Math.floor((left + this.w) / size);
    const ty0 = Math.max(0, Math.floor(top / size));
    const ty1 = Math.min(n - 1, Math.floor((top + this.h) / size));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const wx = ((tx % n) + n) % n;
        const key = `${z0}/${wx}/${ty}`;
        let img = this.tiles.get(key);
        if (img === undefined) {
          img = this.loadTile(key, z0, wx, ty);
        }
        if (img && img !== 'err' && img.complete && img.naturalWidth) {
          ctx.drawImage(img, Math.round(tx * size - left), Math.round(ty * size - top), Math.ceil(size) + 1, Math.ceil(size) + 1);
        }
      }
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = css('--border', '#333');
    ctx.lineWidth = 1;
    const step = 64;
    const c = project(this.center.lat, this.center.lon, this.zoom);
    const ox = -((c.x - this.w / 2) % step);
    const oy = -((c.y - this.h / 2) % step);
    ctx.beginPath();
    for (let x = ox; x < this.w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.h);
    }
    for (let y = oy; y < this.h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
    }
    ctx.stroke();
  }

  private loadTile(key: string, z: number, x: number, y: number): HTMLImageElement {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => this.invalidate();
    img.onerror = () => this.tiles.set(key, 'err');
    img.src = this.opts.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    this.tiles.set(key, img);
    if (this.tiles.size > 400) {
      const first = this.tiles.keys().next().value;
      if (first !== undefined) this.tiles.delete(first);
    }
    return img;
  }

  private drawOverlay(): void {
    const ctx = this.overlay.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const c = project(this.center.lat, this.center.lon, this.zoom);
    const sx = (lon: number, lat: number) => {
      const p = project(lat, lon, this.zoom);
      return { x: p.x - c.x + this.w / 2, y: p.y - c.y + this.h / 2 };
    };
    const casing = css('--bg', '#000');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const l of this.lines) {
      if (l.points.length < 2) continue;
      ctx.beginPath();
      l.points.forEach((pt, i) => {
        const p = sx(pt.lon, pt.lat);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.globalAlpha = l.dim ? 0.45 : 1;
      ctx.strokeStyle = casing;
      ctx.lineWidth = l.width + 4;
      ctx.stroke();
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const text = css('--text', '#fff');
    const showAll = this.zoom >= 15.3;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const m of this.markers) {
      const p = sx(m.lon, m.lat);
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      const big = m.kind === 'from' || m.kind === 'to';
      const r = big ? 9 : m.kind === 'end' ? 6.5 : this.zoom >= 13 ? 4.5 : 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + (m.id === this.selected ? 3 : 0), 0, Math.PI * 2);
      ctx.fillStyle = big ? (m.kind === 'from' ? '#2ecc71' : '#e74c3c') : casing;
      ctx.fill();
      ctx.lineWidth = big ? 3 : 2.5;
      ctx.strokeStyle = big ? '#ffffff' : m.color;
      ctx.stroke();
      if (big || showAll || m.id === this.selected) {
        const label = m.name;
        ctx.lineWidth = 4;
        ctx.strokeStyle = casing;
        ctx.strokeText(label, p.x + r + 6, p.y);
        ctx.fillStyle = text;
        ctx.fillText(label, p.x + r + 6, p.y);
      }
    }
  }
}
