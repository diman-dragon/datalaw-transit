export const enc = new TextEncoder();

/** Пример файла расписания: линия 26 (2 направления, рейс после полуночи), ночная N1, трамвай 2, электричка. */
export function sampleFile(): Record<string, unknown> {
  return {
    format: 'datalaw-schedule/1',
    generated: '2026-10-11T12:00:00Z',
    source: 'gsp.rs',
    validTo: '2027-08-31',
    lines: [
      {
        id: '26',
        short: '26',
        long: 'Мириjево - Бежанијска коса',
        kind: 'bus',
        dirs: [
          {
            from: 'МИРИЈЕВО 4',
            to: 'БЕЖАНИЈСКА КОСА',
            stops: ['МИРИЈЕВО 4', 'ТРГ РЕПУБЛИКЕ', 'БЕЖАНИЈСКА КОСА'],
            validFrom: '2025-03-17',
            times: { weekday: ['04:10', '04:30', '12:00', '24:15'], sat: ['05:00', '05:20'], sun: ['06:00'] },
          },
          { from: 'БЕЖАНИЈСКА КОСА', to: 'МИРИЈЕВО 4', validFrom: '2025-09-01', times: { weekday: ['05:00'], sat: [], sun: ['06:30'] } },
        ],
      },
      { id: 'N1', short: 'N1', long: 'Славија - Земун', night: true, dirs: [{ from: 'СЛАВИЈА', to: 'ЗЕМУН', times: { weekday: ['23:30', '25:10'] } }] },
      { id: '2', short: '2', long: 'Устанички - Калемегдан', kind: 'tram', dirs: [{ from: 'УСТАНИЧКИ', to: 'КАЛЕМЕГДАН', times: { weekday: ['05:00'] } }] },
      { id: 'E2', short: 'E2', long: 'Express', dirs: [{ from: 'A', to: 'B', times: { sat: ['10:00'] } }] },
      { id: '401', short: '401', long: 'Prigrad', dirs: [{ from: 'C', to: 'D', times: { sun: ['10:00'] } }] },
      { id: 'BG', short: 'BG1', long: 'Beovoz', kind: 'rail', dirs: [{ from: 'E', to: 'F', times: { weekday: ['10:00'] } }] },
      { id: 'X', dirs: [{ from: 'A', to: 'B', times: {} }] },
    ],
  };
}

export const bytesOf = (o: unknown): Uint8Array => enc.encode(typeof o === 'string' ? o : JSON.stringify(o));
