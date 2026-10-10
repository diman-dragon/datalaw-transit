import { OSM_TILES, TransitMap } from '../map/map.ts';
import type { MapLine, MapMarker } from '../map/map.ts';
import { prefs } from '../prefs.ts';
import { data } from '../store.ts';
import type { Pattern, Route } from '../types.ts';
import { el, icon } from './dom.ts';
import { href } from './router.ts';

function routeColor(r: Route): string {
  if (r.color) return '#' + r.color;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--c-${r.kind}`).trim();
  return v || '#2b6cb0';
}

export interface MapPanel {
  el: HTMLElement;
  destroy(): void;
}

/** Карта варианта линии: ломаная по остановкам. from/to — позиции участка «от … до …», он подсвечивается. */
export function mapPanel(opts: { route: Route; pattern: Pattern; from?: number; to?: number }): MapPanel {
  const c = data();
  const { pattern: p, route } = opts;
  const color = routeColor(route);
  const hasSeg = opts.from !== undefined && opts.to !== undefined && opts.to > opts.from;
  const pts = p.stops.map((s) => ({ lat: c.stops.lat[s], lon: c.stops.lon[s], s }));
  const valid = (x: { lat: number; lon: number }) => x.lat !== 0 || x.lon !== 0;

  const lines: MapLine[] = [];
  if (hasSeg) {
    lines.push({ points: pts.filter(valid), color, width: 4, dim: true });
    lines.push({ points: pts.slice(opts.from, opts.to! + 1).filter(valid), color, width: 7 });
  } else {
    lines.push({ points: pts.filter(valid), color, width: 6 });
  }
  const markers: MapMarker[] = [];
  pts.forEach((x, i) => {
    if (!valid(x)) return;
    let kind: MapMarker['kind'] = i === 0 || i === pts.length - 1 ? 'end' : 'stop';
    if (hasSeg && i === opts.from) kind = 'from';
    if (hasSeg && i === opts.to) kind = 'to';
    markers.push({ id: String(i), lat: x.lat, lon: x.lon, name: c.stops.name[x.s], code: c.stops.code[x.s], kind, color });
  });

  const info = el('div', { class: 'map-info' }, el('span', { class: 'muted' }, 'Нажмите на остановку на карте'));
  const showInfo = (m: MapMarker | null) => {
    info.replaceChildren();
    if (!m) {
      info.appendChild(el('span', { class: 'muted' }, 'Нажмите на остановку на карте'));
      return;
    }
    const i = Number(m.id);
    const stopId = c.stops.id[p.stops[i]];
    info.append(
      el('div', { class: 'grow' }, el('div', { class: 'title' }, `${i + 1}. ${m.name}`), m.code ? el('div', { class: 'sub' }, `код ${m.code}`) : null),
      el('a', { class: 'btn small', href: href(['stop', stopId], { r: route.id }) }, 'Отправления'),
    );
  };

  const map = new TransitMap({ tiles: prefs.mapTiles, tileUrl: OSM_TILES, onMarker: showInfo });
  map.setData(lines, markers);

  const attribution = el('div', { class: 'map-attr' });
  const syncAttr = () => {
    attribution.textContent = prefs.mapTiles ? '© OpenStreetMap' : 'без подложки';
  };
  syncAttr();
  const btn = (label: string, ic: Parameters<typeof icon>[0], fn: () => void) =>
    el('button', { class: 'map-btn', 'aria-label': label, onclick: fn }, icon(ic));
  const controls = el(
    'div',
    { class: 'map-controls' },
    btn('Приблизить', 'plus', () => map.zoomBy(1)),
    btn('Отдалить', 'minus', () => map.zoomBy(-1)),
    btn('Показать весь маршрут', 'fit', () => map.fit()),
    btn('Подложка карты вкл/выкл', 'layers', () => {
      prefs.setMapTiles(!prefs.mapTiles);
      map.setTiles(prefs.mapTiles);
      syncAttr();
    }),
  );
  const box = el('div', { class: 'mapbox' }, map.el, controls, attribution);
  return { el: el('div', { class: 'mappanel' }, box, info), destroy: () => map.destroy() };
}
