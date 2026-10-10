#!/usr/bin/env node
/**
 * Подготовка сгенерированного Capacitor-проекта android/ после `npx cap sync android`:
 *  - копирует иконки из resources/android/res;
 *  - убирает шаблонные иконки, которые мешают (webp / старые векторные);
 *  - прописывает versionName из package.json и versionCode (номер запуска Actions или из версии).
 * Скрипт идемпотентный: можно запускать сколько угодно раз.
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const androidDir = join(root, 'android');
const resDir = join(androidDir, 'app', 'src', 'main', 'res');

if (!existsSync(androidDir)) {
  console.error('Нет папки android/. Сначала выполните: npx cap add android');
  process.exit(1);
}

// ---- иконки
for (const d of readdirSync(resDir)) {
  if (!d.startsWith('mipmap-')) continue;
  for (const f of readdirSync(join(resDir, d))) {
    if (/^ic_launcher.*\.(webp|png|xml)$/.test(f)) rmSync(join(resDir, d, f));
  }
}
for (const p of ['drawable/ic_launcher_background.xml', 'drawable-v24/ic_launcher_foreground.xml']) {
  rmSync(join(resDir, p), { force: true });
}
cpSync(join(root, 'resources', 'android', 'res'), resDir, { recursive: true });
console.log('Иконки DataLaw скопированы.');

// ---- версия
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const [maj = 0, min = 0, pat = 0] = String(pkg.version).split('.').map((n) => parseInt(n, 10) || 0);
const semverCode = maj * 10000 + min * 100 + pat;
const runNumber = parseInt(process.env.GITHUB_RUN_NUMBER ?? '', 10);
// versionCode должен только расти, чтобы APK ставился поверх предыдущего
const versionCode = Number.isFinite(runNumber) ? Math.max(runNumber, 1) + semverCode * 1000 : Math.max(semverCode, 1);

const gradleFile = ['build.gradle', 'build.gradle.kts'].map((f) => join(androidDir, 'app', f)).find((f) => existsSync(f));
if (!gradleFile) {
  console.warn('app/build.gradle не найден — версия Android не обновлена');
} else {
  let g = readFileSync(gradleFile, 'utf8');
  const before = g;
  g = g.replace(/versionCode\s*=?\s*\d+/, (m) => (m.includes('=') ? `versionCode = ${versionCode}` : `versionCode ${versionCode}`));
  g = g.replace(/versionName\s*=?\s*"[^"]*"/, (m) => (m.includes('=') ? `versionName = "${pkg.version}"` : `versionName "${pkg.version}"`));
  if (g === before) console.warn('Не удалось найти versionCode/versionName в', gradleFile);
  writeFileSync(gradleFile, g);
  console.log(`versionName ${pkg.version}, versionCode ${versionCode}`);
}
