/** Источники расписания: официальный открытый GTFS на портале data.gov.rs. */
export interface FeedCfg {
  /** префикс идентификаторов линий в приложении: 'c:26' */
  key: string;
  name: string;
  url: string;
}

export const FEEDS: FeedCfg[] = [
  {
    key: 'c',
    name: 'Городской транспорт',
    url: 'https://data.gov.rs/sr/datasets/r/729be9a1-7ed9-453d-9a3d-68fa30f07529',
  },
  {
    key: 'p',
    name: 'Пригородные автобусы',
    url: 'https://data.gov.rs/sr/datasets/r/60f82229-16c7-4939-961b-2c24873d3e06',
  },
];
