import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, Cell,
} from 'recharts'
import { detect, tariffWhatIf, fmtUSD, fmtNum } from './model.js'
import { t, numLocale, GT_LABELS } from './strings.js'

const BASE = import.meta.env.BASE_URL
const DEFAULT_W = { margin: 0.30, vpn: 0.25, overage: 0.15, geo: 0.15, duplicate: 0.15 }
const SIG_KEYS = ['margin', 'vpn', 'overage', 'geo', 'duplicate']
const SIG_COLORS = { margin: '#e2575b', vpn: '#e8a33d', overage: '#4ea8de', geo: '#b07de2', duplicate: '#36c2a4' }

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [lang, setLang] = useState('en')
  const [threshold, setThreshold] = useState(0.45)
  const [weights, setWeights] = useState({ ...DEFAULT_W })
  const [tab, setTab] = useState('detector')
  const [flatMult, setFlatMult] = useState(1)
  const [elasticMult, setElasticMult] = useState(1)
  const [blendedMult, setBlendedMult] = useState(1)

  const L = t(lang); const loc = numLocale(lang)
  const usd = (v) => fmtUSD(v, loc)

  useEffect(() => {
    fetch(`${BASE}data/accounts.json`).then(r => r.json()).then(setData).catch(e => setError(String(e)))
  }, [])

  const res = useMemo(() => {
    if (!data) return null
    return detect(data.accounts, data._meta, { weights, threshold })
  }, [data, weights, threshold])

  const tf = useMemo(() => {
    if (!data) return null
    return tariffWhatIf(data.accounts, data._meta, { flatMult, elasticMult, blendedMult })
  }, [data, flatMult, elasticMult, blendedMult])

  if (error) return <div className="app"><p style={{ color: 'var(--danger)' }}>{error}</p></div>
  if (!data || !res) return <div className="app"><p>{L.loading}</p></div>

  const T = res.totals
  // валидация против ground_truth
  const gt = {}, caught = {}
  for (const s of res.scored) { gt[s.ground_truth] = (gt[s.ground_truth] || 0) + 1; if (s.flagged) caught[s.ground_truth] = (caught[s.ground_truth] || 0) + 1 }
  const seededKeys = ['negative_margin', 'vpn_proxy', 'overage_abuse', 'geo_anomaly', 'duplicate_pattern']
  const totalSeeded = seededKeys.reduce((s, k) => s + (gt[k] || 0), 0)
  const totalCaught = seededKeys.reduce((s, k) => s + (caught[k] || 0), 0)
  const cleanN = gt['clean'] || 0
  const cleanFlagged = caught['clean'] || 0

  const balanceData = res.byRegion.map(r => ({ region: r.region, revenue: Math.round(r.revenue), cost: Math.round(r.cost) }))
  const marginData = res.byRegion.map(r => ({ region: r.region, margin: Math.round(r.margin) }))

  const setW = (k, v) => setWeights(w => ({ ...w, [k]: v }))

  return (
    <div className="app">
      <header className="top">
        <div className="title">
          <h1>Traffic Fraud &amp; Unmetered Economics Detector</h1>
          <p>{L.subtitle}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="badge">{L.badge}</div>
          <button className="lang-btn" onClick={() => setLang(lang === 'en' ? 'ru' : 'en')}>{L.langBtn}</button>
        </div>
      </header>

      <div className="cur-switch" style={{ marginTop: 14 }}>
        <button className={tab === 'detector' ? 'active' : ''} onClick={() => setTab('detector')}>{L.tabDetector}</button>
        <button className={tab === 'tariff' ? 'active' : ''} onClick={() => setTab('tariff')}>{L.tabTariff}</button>
      </div>

      {tab === 'detector' && (
      <div className="layout">
        <aside className="panel">
          <h2>{L.detectorTitle}</h2>
          <div className="control">
            <label><span>{L.threshold} <Help txt={L.help.threshold} /></span><b>{threshold.toFixed(2)}</b></label>
            <input type="range" min="0.30" max="0.70" step="0.01" value={threshold} onChange={e => setThreshold(+e.target.value)} />
          </div>
          <h2 style={{ marginTop: 18 }}>{L.weightsTitle}</h2>
          {SIG_KEYS.map(k => (
            <div className="control" key={k}>
              <label><span><span style={{ color: SIG_COLORS[k] }}>■</span> {L['w' + k[0].toUpperCase() + k.slice(1)]} <Help txt={L.help[k]} /></span><b>{weights[k].toFixed(2)}</b></label>
              <input type="range" min="0" max="0.5" step="0.01" value={weights[k]} onChange={e => setW(k, +e.target.value)} />
            </div>
          ))}
          <button className="lang-btn" style={{ marginTop: 6, fontSize: 12, fontWeight: 500 }}
            onClick={() => { setWeights({ ...DEFAULT_W }); setThreshold(0.45) }}>{L.reset}</button>
        </aside>

        <main>
          <div className="kpis">
            <div className="kpi"><div className="k-label">{L.revenue}</div><div className="k-val">{usd(T.revenue)}</div><div className="k-sub">{L.usdEq}</div></div>
            <div className="kpi"><div className="k-label">{L.cost}</div><div className="k-val">{usd(T.cost)}</div><div className="k-sub">{L.usdEq}</div></div>
            <div className="kpi"><div className="k-label">{L.margin}</div><div className={'k-val ' + (T.margin >= 0 ? 'delta-up' : 'delta-down')}>{usd(T.margin)}</div><div className="k-sub">{Math.round(100 * T.margin / T.revenue)}%</div></div>
            <div className="kpi"><div className="k-label">{L.flagged}</div><div className="k-val delta-down">{T.flagged}</div><div className="k-sub">{L.flaggedSub(res.scored.length)} · {L.negMarginSub(T.negMargin)}</div></div>
            <div className="kpi"><div className="k-label">{L.revAtRisk}</div><div className="k-val delta-down">{usd(res.byRegion.reduce((s, x) => s + x.revAtRisk, 0))}</div><div className="k-sub">{L.usdEq}</div></div>
          </div>

          <div className="grid-2">
            <div className="panel">
              <p className="section-title">{L.balanceTitle}</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={balanceData} margin={{ top: 6, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2f3b4a" />
                  <XAxis dataKey="region" tick={{ fill: '#93a1b0', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#93a1b0', fontSize: 11 }} width={54} />
                  <Tooltip contentStyle={{ background: '#1a212b', border: '1px solid #2f3b4a', borderRadius: 8, color: '#e6edf3' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name={L.legRevenue} fill="#36c2a4" />
                  <Bar dataKey="cost" name={L.legCost} fill="#e2575b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="panel">
              <p className="section-title">{L.marginTitle}</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={marginData} margin={{ top: 6, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2f3b4a" />
                  <XAxis dataKey="region" tick={{ fill: '#93a1b0', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#93a1b0', fontSize: 11 }} width={54} />
                  <Tooltip contentStyle={{ background: '#1a212b', border: '1px solid #2f3b4a', borderRadius: 8, color: '#e6edf3' }} />
                  <Bar dataKey="margin" name="margin">
                    {marginData.map((d, i) => <Cell key={i} fill={d.margin < 0 ? '#e2575b' : '#36c2a4'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <p className="section-title">{L.valTitle}</p>
            <div className="note">
              {L.valNote(totalCaught, totalSeeded).replace('{clean}', cleanN)} {cleanFlagged > 0 ? `(⚠ ${cleanFlagged})` : '✓'}
            </div>
            <div className="legend" style={{ marginTop: 8 }}>
              {seededKeys.map(k => (
                <span key={k}>{GT_LABELS[lang][k]}: <b style={{ color: (caught[k] || 0) === (gt[k] || 0) ? 'var(--accent)' : 'var(--warn)' }}>{caught[k] || 0}/{gt[k] || 0}</b></span>
              ))}
            </div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <p className="section-title">{L.tableTitle}</p>
            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{L.colPayer}</th><th>{L.colRegion}</th><th className="num">{L.colBand}</th>
                    <th>{L.colSignals}</th><th className="num">{L.colMargin}</th><th className="num">{L.colScore}</th>
                  </tr>
                </thead>
                <tbody>
                  {res.topExploiters.map(s => (
                    <tr key={s.account_no} className={s.flagged ? 'flagged' : ''}>
                      <td>{s.payer}</td>
                      <td>{s.region}</td>
                      <td className="num">{fmtNum(s.avg_band_mbps, loc, 0)}</td>
                      <td><SignalBars sub={s.sub} /></td>
                      <td className="num" style={{ color: s.margin < 0 ? 'var(--danger)' : 'var(--muted)' }}>{usd(s.margin)}</td>
                      <td className="num">
                        <span className="score-pill" style={{ background: s.flagged ? 'rgba(226,87,91,.18)' : 'rgba(54,194,164,.15)', color: s.flagged ? '#e2575b' : '#36c2a4' }}>{s.score.toFixed(3)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note">{L.sigLegend}</div>
          </div>
        </main>
      </div>
      )}

      {tab === 'tariff' && (
        <TariffView tf={tf} L={L} usd={usd}
          flatMult={flatMult} setFlatMult={setFlatMult}
          elasticMult={elasticMult} setElasticMult={setElasticMult}
          blendedMult={blendedMult} setBlendedMult={setBlendedMult} />
      )}

      <p className="foot">{L.foot} <span className="tag-illu">{L.footIllu}</span>.</p>
    </div>
  )
}

function SignalBars({ sub }) {
  const keys = ['margin', 'vpn', 'overage', 'geo', 'duplicate']
  return (
    <span className="sig">
      {keys.map(k => (
        <i key={k} title={`${k}: ${sub[k].toFixed(2)}`}
           style={{ height: `${Math.max(2, sub[k] * 18)}px`, background: sub[k] > 0.05 ? SIG_COLORS[k] : 'var(--line)' }} />
      ))}
    </span>
  )
}

function Help({ txt }) {
  return <span title={txt} style={{ cursor: 'help', color: 'var(--muted)', fontSize: 12 }}>ⓘ</span>
}

function TariffView({ tf, L, usd, flatMult, setFlatMult, elasticMult, setElasticMult, blendedMult, setBlendedMult }) {
  if (!tf) return null
  const T = tf.totals
  const chart = tf.byRegion.map(r => ({ region: r.region, current: Math.round(r.curMargin), flat: Math.round(r.flatMargin), elastic: Math.round(r.elasticMargin) }))
  return (
    <div className="layout">
      <aside className="panel">
        <h2>{L.tfTitle}</h2>
        <div className="note" style={{ marginBottom: 14 }}>{L.tfPatterns}</div>
        <div className="control">
          <label><span>{L.tfFlatMult}</span><b>×{flatMult.toFixed(2)}</b></label>
          <input type="range" min="0.5" max="2" step="0.05" value={flatMult} onChange={e => setFlatMult(+e.target.value)} />
        </div>
        <div className="control">
          <label><span>{L.tfElasticMult}</span><b>×{elasticMult.toFixed(2)}</b></label>
          <input type="range" min="0.5" max="3" step="0.05" value={elasticMult} onChange={e => setElasticMult(+e.target.value)} />
        </div>
        <div className="control">
          <label><span>{L.tfBlendedMult}</span><b>×{blendedMult.toFixed(2)}</b></label>
          <input type="range" min="0.5" max="2" step="0.05" value={blendedMult} onChange={e => setBlendedMult(+e.target.value)} />
        </div>
        <button className="lang-btn" style={{ marginTop: 6, fontSize: 12, fontWeight: 500 }}
          onClick={() => { setFlatMult(1); setElasticMult(1); setBlendedMult(1) }}>{L.reset}</button>
      </aside>
      <main>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div className="kpi"><div className="k-label">{L.kCurrent}</div><div className={'k-val ' + (T.curMargin >= 0 ? 'delta-up' : 'delta-down')}>{usd(T.curMargin)}</div><div className="k-sub">{L.usdEq}</div></div>
          <div className="kpi"><div className="k-label">{L.kFlat}</div><div className={'k-val ' + (T.flatMargin >= 0 ? 'delta-up' : 'delta-down')}>{usd(T.flatMargin)}</div><div className="k-sub">Δ {usd(T.flatMargin - T.curMargin)}</div></div>
          <div className="kpi"><div className="k-label">{L.kElastic}</div><div className={'k-val ' + (T.elasticMargin >= 0 ? 'delta-up' : 'delta-down')}>{usd(T.elasticMargin)}</div><div className="k-sub">Δ {usd(T.elasticMargin - T.curMargin)}</div></div>
        </div>
        <div className="panel" style={{ marginTop: 18 }}>
          <p className="section-title">{L.tfChartTitle}</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chart} margin={{ top: 6, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2f3b4a" />
              <XAxis dataKey="region" tick={{ fill: '#93a1b0', fontSize: 11 }} />
              <YAxis tick={{ fill: '#93a1b0', fontSize: 11 }} width={60} />
              <Tooltip contentStyle={{ background: '#1a212b', border: '1px solid #2f3b4a', borderRadius: 8, color: '#e6edf3' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="current" name={L.legCur} fill="#4ea8de" />
              <Bar dataKey="flat" name={L.legFlat} fill="#36c2a4" />
              <Bar dataKey="elastic" name={L.legElastic} fill="#e8a33d" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel" style={{ marginTop: 18 }}>
          <p className="section-title">{L.tfTableTitle}</p>
          <table>
            <thead>
              <tr><th>{L.colRegion2}</th><th className="num">{L.colCost2}</th><th className="num">{L.colCur}</th><th className="num">{L.colFlat}</th><th className="num">{L.colElastic}</th></tr>
            </thead>
            <tbody>
              {tf.byRegion.map(r => (
                <tr key={r.region}>
                  <td>{r.region}</td>
                  <td className="num">{usd(r.cost)}</td>
                  <td className="num" style={{ color: r.curMargin < 0 ? 'var(--danger)' : 'var(--muted)' }}>{usd(r.curMargin)}</td>
                  <td className="num" style={{ color: r.flatMargin < 0 ? 'var(--danger)' : 'var(--accent)' }}>{usd(r.flatMargin)}</td>
                  <td className="num" style={{ color: r.elasticMargin < 0 ? 'var(--danger)' : 'var(--warn)' }}>{usd(r.elasticMargin)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Σ</td>
                <td className="num">{usd(T.cost)}</td>
                <td className="num">{usd(T.curMargin)}</td>
                <td className="num">{usd(T.flatMargin)}</td>
                <td className="num">{usd(T.elasticMargin)}</td>
              </tr>
            </tbody>
          </table>
          <div className="note">{L.tfNote}</div>
        </div>
      </main>
    </div>
  )
}
