// Traffic-exploiter detector + unmetered economics.
// Зеркалит Python-эталон verify/detector_ref.py (паритет до 3 знака).
// Веса детектора — ГИПОТЕЗА (канонической модели нет, в отличие от churn-кейса): из _meta.detector_weights.

export const REGIONS = ['MSK', 'WAW', 'SFO', 'MIA', 'DFW', 'ALA', 'MNL']
export const CURRENCY_SYMBOL = { RUB: '₽', USD: '$', KZT: '₸' }

const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const median = (arr) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// transit $/Mbps и FX берём из _meta (источник истины — generate.py / research).
export function detect(accounts, meta, { weights, threshold } = {}) {
  const W = weights || meta.detector_weights
  const TR = meta.transit_usd_per_mbps
  const thr = threshold ?? meta.detector_threshold ?? 0.45

  // медиана полосы по региону (для гео-аномалии)
  const regMed = {}
  for (const r of REGIONS) {
    regMed[r] = median(accounts.filter(a => a.region === r).map(a => a.avg_band_mbps))
  }
  // частоты фингерпринтов (дубль-паттерн)
  const fpCount = {}
  const fpPayers = {}
  for (const a of accounts) {
    fpCount[a.fingerprint] = (fpCount[a.fingerprint] || 0) + 1
    ;(fpPayers[a.fingerprint] = fpPayers[a.fingerprint] || new Set()).add(a.payer)
  }

  const scored = accounts.map(a => {
    const revenue = a.plan_price_usd + a.compute_rev_usd
    const transit = a.peak_band_mbps * (TR[a.region] || 0.3)
    const margin = revenue - transit

    // 1) margin pressure: транзит ест >50% выручки → растёт, ≥150% → 1
    const ratio = revenue > 0 ? transit / revenue : 2
    const sMargin = clamp((ratio - 0.5) / 1.0, 0, 1)

    // 2) vpn/proxy: тонкий compute + симметрия out/in + круглосуточность
    const cpm = a.avg_band_mbps > 0 ? a.compute_units / a.avg_band_mbps : 99
    const sCompute = clamp((3.0 - cpm) / 3.0, 0, 1)
    const sSym = clamp(1 - Math.abs(a.out_in_ratio - 1.0) / 0.3, 0, 1)
    const sDuty = clamp((a.duty_cycle - 0.6) / 0.35, 0, 1)
    const sVpn = clamp(0.5 * sCompute + 0.25 * sSym + 0.25 * sDuty, 0, 1)

    // 3) overage abuse: полоса выше committed + часы превышения
    const overRatio = a.committed_mbps > 0 ? a.avg_band_mbps / a.committed_mbps : 0
    const sOverage = clamp(0.5 * clamp(overRatio - 1, 0, 1) + 0.5 * clamp(a.overage_hours / 300, 0, 1), 0, 1)

    // 4) geo anomaly: полоса кратно выше медианы региона (3x→старт, 10x→1)
    const z = regMed[a.region] > 0 ? a.avg_band_mbps / regMed[a.region] : 0
    const sGeo = clamp((z - 3) / 7, 0, 1)

    // 5) duplication: коллизия фингерпринта у разных аккаунтов; буст при общем payer
    const dupN = fpCount[a.fingerprint]
    let sDup = clamp((dupN - 1) / 3, 0, 1)
    if (dupN >= 2 && fpPayers[a.fingerprint].size < dupN) sDup = Math.max(sDup, 0.6) // дубли под одним бенефициаром
    // дубли держатся ПОД committed (без превышений) — это и есть схема обхода
    if (dupN >= 2 && a.overage_hours === 0 && a.avg_band_mbps > 0.7 * a.committed_mbps) sDup = Math.max(sDup, 0.7)

    const score =
      W.margin * sMargin + W.vpn * sVpn + W.overage * sOverage + W.geo * sGeo + W.duplicate * sDup

    return {
      account_no: a.account_no, payer: a.payer, provider: a.provider, currency: a.currency,
      region: a.region, avg_band_mbps: a.avg_band_mbps, peak_band_mbps: a.peak_band_mbps,
      committed_mbps: a.committed_mbps, revenue, transit, margin, score,
      sub: { margin: sMargin, vpn: sVpn, overage: sOverage, geo: sGeo, duplicate: sDup },
      ground_truth: a.ground_truth,
      flagged: score >= thr,
    }
  })

  // экономика по регионам (USD-eq)
  const byRegion = REGIONS.map(r => {
    const cr = scored.filter(s => s.region === r)
    if (!cr.length) return null
    const revenue = cr.reduce((s, x) => s + x.revenue, 0)
    const cost = cr.reduce((s, x) => s + x.transit, 0)
    const flagged = cr.filter(s => s.flagged)
    const revAtRisk = flagged.reduce((s, x) => s + Math.max(0, -x.margin), 0) // отрицательная маржа флагнутых
    return { region: r, revenue, cost, margin: revenue - cost, n: cr.length,
             flagged: flagged.length, revAtRisk }
  }).filter(Boolean)

  const totals = {
    revenue: byRegion.reduce((s, x) => s + x.revenue, 0),
    cost: byRegion.reduce((s, x) => s + x.cost, 0),
    flagged: scored.filter(s => s.flagged).length,
    negMargin: scored.filter(s => s.margin < 0).length,
  }
  totals.margin = totals.revenue - totals.cost

  const topExploiters = [...scored].sort((a, b) => b.score - a.score).slice(0, 30)
  return { scored, byRegion, totals, topExploiters }
}

// ── Реальные опорные тарифы 3HCloud (из прайса; MSK — оценка, нет в таблице) ──
export const FLAT_TIERS = [100, 500, 1000, 2000, 5000, 10000] // committed Mbps
export const FLAT_TARIFF = { // месячная цена flat-rate unmetered, USD, по региону×тиру
  MNL: [200, 550, 1000, 1900, 4500, 8000],
  DFW: [50, 138, 250, 475, 1125, 2000],
  MIA: [50, 138, 250, 475, 1125, 2000],
  WAW: [50, 138, 250, 475, 1125, 2000],
  SFO: [50, 138, 250, 475, 1125, 2000],
  ALA: [114, 314, 570, 1083, 2565, 4560],
  MSK: [50, 138, 250, 475, 1125, 2000], // оценка ≈ Warsaw (нет в реальном прайсе)
}
export const ELASTIC_TARIFF = { // hourly $/Mbps сверх базовых 10 Mb/s; r1g — для скорости >1 Gb/s
  MNL: { r10: 0.002, r1g: 0.001 },
  DFW: { r10: 0.0004, r1g: 0.0003 },
  MIA: { r10: 0.0004, r1g: 0.0003 },
  WAW: { r10: 0.0004, r1g: 0.0003 },
  SFO: { r10: 0.0004, r1g: 0.0003 },
  ALA: { r10: 0.0007, r1g: 0.0005 },
  MSK: { r10: 0.0004, r1g: 0.0003 }, // оценка
}
export const HOURS_MONTH = 730
export const ELASTIC_BASE_MBPS = 10 // базовые 10 Mb/s включены
export const TARIFF_ESTIMATE_REGIONS = ['MSK']

// What-if: текущий план vs Flat-Unmetered vs Elastic(10Mb/s + превышение).
// Множители позволяют варьировать тарифы и стоимость канала.
export function tariffWhatIf(accounts, meta, { flatMult = 1, elasticMult = 1, blendedMult = 1 } = {}) {
  const TR = meta.transit_usd_per_mbps
  const per = accounts.map(a => {
    const compute = a.compute_rev_usd
    const transit = a.peak_band_mbps * (TR[a.region] || 0.3) * blendedMult
    const curRev = a.plan_price_usd + compute
    // Flat: наименьший порт-тир, покрывающий пик
    let ti = FLAT_TIERS.findIndex(t => t >= a.peak_band_mbps)
    if (ti === -1) ti = FLAT_TIERS.length - 1
    const flatRev = (FLAT_TARIFF[a.region]?.[ti] ?? 0) * flatMult + compute
    // Elastic: базовые 10 Mb/s включены, выше — почасово за Mbps
    const er = ELASTIC_TARIFF[a.region] || { r10: 0.0004, r1g: 0.0003 }
    const rate = (a.avg_band_mbps > 1000 ? er.r1g : er.r10) * elasticMult
    const elasticRev = Math.max(0, a.avg_band_mbps - ELASTIC_BASE_MBPS) * rate * HOURS_MONTH + compute
    return {
      account_no: a.account_no, region: a.region, avg_band_mbps: a.avg_band_mbps,
      peak_band_mbps: a.peak_band_mbps, port_tier: FLAT_TIERS[ti], transit,
      curRev, flatRev, elasticRev,
      curMargin: curRev - transit, flatMargin: flatRev - transit, elasticMargin: elasticRev - transit,
    }
  })
  const agg = (rows) => ({
    curRev: rows.reduce((s, x) => s + x.curRev, 0),
    flatRev: rows.reduce((s, x) => s + x.flatRev, 0),
    elasticRev: rows.reduce((s, x) => s + x.elasticRev, 0),
    cost: rows.reduce((s, x) => s + x.transit, 0),
    curMargin: rows.reduce((s, x) => s + x.curMargin, 0),
    flatMargin: rows.reduce((s, x) => s + x.flatMargin, 0),
    elasticMargin: rows.reduce((s, x) => s + x.elasticMargin, 0),
    n: rows.length,
  })
  const byRegion = REGIONS.map(r => {
    const rows = per.filter(x => x.region === r)
    if (!rows.length) return null
    return { region: r, ...agg(rows) }
  }).filter(Boolean)
  return { per, byRegion, totals: agg(per) }
}

export function fmtUSD(v, locale = 'en-US') {
  if (v == null) return '—'
  const n = Math.round(v).toLocaleString(locale)
  return `$${n}`
}
export function fmtNum(v, locale = 'en-US', d = 0) {
  if (v == null) return '—'
  return Number(v).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })
}
