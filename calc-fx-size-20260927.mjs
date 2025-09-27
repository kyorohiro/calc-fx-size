#!/usr/bin/env node
/**
 * FX position size calculator (Node ESM)
 * - 口座リスク率 × 口座残高 を、(実効ストップpips × 1通貨あたりのpip価値) で割って数量を出します。
 * - 1ロット=10,000通貨（デフォルト）。必要なら lotSize を変えてください。
 *
 * 使用例:
 *   node calc-fx-size.mjs --balance 10000000 --risk 0.01 --stop 15 --spread 1.0 --pair GBPJPY --lotSize 10000
 *
 * メモ:
 * - pipサイズ: JPY建て=0.01, それ以外=0.0001（例外通貨は必要に応じて拡張）
 * - quoteToAccountRate: 口座通貨≠クォート通貨のときの換算（例: EURUSDで口座JPYならUSDJPYレートを渡す）
 * - minStep: ブローカー最小単位に丸め（例: 1000通貨刻み）
 */

/** @typedef {{
 *   balance: number,            // 口座残高（口座通貨）
 *   riskPct?: number,           // 1トレードのリスク率（例: 0.01=1%）
 *   stopPips: number,           // テクニカルSL（pips）
 *   spreadPips?: number,        // スプレッド上乗せ（pips）
 *   pair?: string,              // 通貨ペア（例: 'GBPJPY', 'EURUSD'）
 *   lotSize?: number,           // 1ロットの通貨数量（デフォルト 10000）
 *   quoteToAccountRate?: number,// クォート通貨→口座通貨の換算レート（デフォ:1=同通貨）
 *   minStep?: number            // 通貨数量の最小刻み（例: 1000）
 * }} CalcInput */

/** @typedef {{
 *   units: number,              // 通貨数量（丸め済み）
 *   lots: number,               // ロット数（lotSize基準）
 *   pipSize: number,            // 1pipの価格刻み
 *   pipValuePerUnit: number,    // 1通貨あたりの1pip価値（口座通貨）
 *   effectiveStopPips: number,  // 実効ストップ（stop + spread）
 *   plannedRiskAmount: number   // 想定損失額（口座通貨）
 * }} CalcResult */

/** JPY建て判定でpipサイズを返す */
function getPipSize(pair = "GBPJPY") {
  const base = pair.toUpperCase();
  // 簡易判定（末尾がJPYならpip=0.01）
  if (base.endsWith("JPY")) return 0.01;
  // 必要ならここにXAUUSD等の例外を追加
  return 0.0001;
}

/**
 * 口座通貨＝クォート通貨の時は quoteToAccountRate=1。
 * 例えば EURUSD で口座JPYなら、USDJPY のレートを quoteToAccountRate に渡す。
 * @param {CalcInput} p
 * @returns {CalcResult}
 */
export function calcPositionSize(p) {
  const {
    balance,
    riskPct = 0.01,
    stopPips,
    spreadPips = 0,
    pair = "GBPJPY",
    lotSize = 10000,
    quoteToAccountRate = 1,
    minStep = 1000,
  } = p;

  if (!Number.isFinite(balance) || balance <= 0) throw new Error("balance must be > 0");
  if (!Number.isFinite(riskPct) || riskPct <= 0) throw new Error("riskPct must be > 0");
  if (!Number.isFinite(stopPips) || stopPips <= 0) throw new Error("stopPips must be > 0");
  if (!Number.isFinite(spreadPips) || spreadPips < 0) throw new Error("spreadPips must be >= 0");
  if (!Number.isFinite(lotSize) || lotSize <= 0) throw new Error("lotSize must be > 0");
  if (!Number.isFinite(quoteToAccountRate) || quoteToAccountRate <= 0) {
    throw new Error("quoteToAccountRate must be > 0");
  }
  if (!Number.isFinite(minStep) || minStep <= 0) throw new Error("minStep must be > 0");

  const pipSize = getPipSize(pair);
  // 1通貨あたりの1pip価値（口座通貨）
  const pipValuePerUnit = pipSize * quoteToAccountRate;

  const effectiveStopPips = stopPips + spreadPips; // SLにスプレッド上乗せ
  const riskAmount = balance * riskPct;

  // 生の必要通貨数量
  const rawUnits = riskAmount / (effectiveStopPips * pipValuePerUnit);

  // ブローカーの最小刻みに丸め
  const units = Math.floor(rawUnits / minStep) * minStep;

  const lots = units / lotSize;
  const plannedRiskAmount = units * pipValuePerUnit * effectiveStopPips;

  return {
    units,
    lots,
    pipSize,
    pipValuePerUnit,
    effectiveStopPips,
    plannedRiskAmount,
  };
}

/** --- 以下はCLI実行用（node calc-fx-size.mjs ...） --- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((t) => {
      const [k, v] = t.replace(/^--/, "").split("=");
      return [k, v ?? true];
    })
  );

  function num(name, def) {
    if (args[name] === undefined) return def;
    const x = Number(args[name]);
    if (!Number.isFinite(x)) throw new Error(`Invalid number for --${name}`);
    return x;
  }
  const str = (name, def) => (args[name] === undefined ? def : String(args[name]));

  const balance = num("balance", NaN);           // 必須
  const risk = num("risk", 0.01);                // 1%=0.01
  const stop = num("stop", NaN);                 // 必須
  const spread = num("spread", 0);               // 例: 1.0
  const pair = str("pair", "GBPJPY");            // 例: GBPJPY / EURUSD
  const lotSize = num("lotSize", 10000);         // 1ロット=10,000通貨
  const q2a = num("quoteToAccountRate", 1);      // 例: EURUSD×USDJPYレート
  const minStep = num("minStep", 1000);          // 数量の丸め刻み

  if (!Number.isFinite(balance) || !Number.isFinite(stop)) {
    console.error("Usage: node calc-fx-size.mjs --balance 10000000 --risk 0.01 --stop 15 --spread 1.0 --pair GBPJPY --lotSize 10000 [--quoteToAccountRate 1] [--minStep 1000]");
    process.exit(1);
  }

  const res = calcPositionSize({
    balance,
    riskPct: risk,
    stopPips: stop,
    spreadPips: spread,
    pair,
    lotSize,
    quoteToAccountRate: q2a,
    minStep,
  });

  // きれいに表示
  const fmt = new Intl.NumberFormat("ja-JP");
  console.log(`Pair: ${pair}`);
  console.log(`口座残高: ${fmt.format(balance)} / リスク: ${(risk * 100).toFixed(2)}%`);
  console.log(`pipサイズ: ${res.pipSize} / 1通貨pip価値(口座通貨): ${res.pipValuePerUnit}`);
  console.log(`実効ストップ: ${res.effectiveStopPips} pips (含: spread ${spread})`);
  console.log(`推奨 通貨数量: ${fmt.format(res.units)} 通貨 (丸め: ${minStep})`);
  console.log(`推奨 ロット数: ${res.lots} ロット（1ロット=${fmt.format(lotSize)}通貨）`);
  console.log(`想定損失額: 約 ${fmt.format(Math.round(res.plannedRiskAmount))}`);
}
