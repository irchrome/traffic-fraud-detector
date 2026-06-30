# Traffic Fraud & Unmetered Economics Detector — прототип

React-дашборд (Vite + Recharts) для Product Owner'а IaaS: ловит фрод-трафик, VPN/proxy-эксплуатацию и **утечки маржи на unmetered-планах**, балансируя доход и расход (IP-транзит) по регионам.

> **Данные синтетические** — по реальному распределению трафика 3HCloud (ноя-2025), без реальных payer/счетов/UUID. Вывод детектора — иллюстрация. Бейдж честности в UI.

## Что внутри
- **Детектор эксплуататоров** — взвешенный score из 5 сигналов: отрицательная маржа · VPN/proxy-паттерн · злоупотребление превышениями · гео-аномалия · дубль-паттерн (клоны под одним бенефициаром, держащиеся под committed для обхода превышений).
- **Unmetered-экономика по регионам** — выручка vs стоимость IP-транзита (peak Mbps × blended $/Mbps по региону) → чистая маржа; единая цена плана + дорогой регион = убыток (видно на MNL/ALA).
- **Валидация** — на засеянных синтетических эксплуататорах (ground_truth) показывает recall и ложные срабатывания.
- **i18n EN/RU** — переключатель в шапке, дефолт English.

## Запуск / сборка / деплой
```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # → dist/
npm run deploy    # build + публикация в ветку gh-pages
```
GitHub Pages: `base` в `vite.config.js` = `/<repo>/` (дефолт `/traffic-fraud-detector/`; или `GHPAGES_BASE=/repo/ npm run deploy`). Полный runbook — `DEPLOY.md`.

## Сверка модели (verification)
```bash
python3 verify/generate.py       # сгенерировать синтетику (детерминированно, seed=42)
python3 verify/detector_ref.py   # Python-эталон: экономика + качество детекции
node    verify/parity.mjs        # JS-модель ↔ Python-эталон (паритет до 3 знака)
```
`src/model.js` зеркалит `verify/detector_ref.py`. Транзит-цены и веса — в `_meta` (источник: `../research/transit-prices.md`).

## Честность
- Веса детектора — прозрачная **гипотеза**, не калиброванная прод-модель.
- Транзит-цены — **оценка по рынку** из открытых источников (TeleGeography / Shift Hosting / DCConnect 2026), не котировки провайдеров.
- Без вызовов LLM/API в рантайме.
