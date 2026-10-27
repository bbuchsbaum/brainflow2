/**
 * Distribution functions for the population stage (phase 4 E4: t-based 95%
 * intervals) and the harness's cluster-extent mirror: ln Γ, the regularized
 * incomplete beta, Student's t tail and quantile, the normal tail, and the
 * type-7 sample quantile (R's default, numpy's 'linear').
 */

/** ln Γ(x), Lanczos (g = 7, n = 9): ~1e-15 relative for x > 0. */
export function lnGamma(x: number): number {
  const c = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012, 0.000009984369578019572,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** erfc(x), W. J. Cody's rational approximations (~1e-15 relative). */
export function erfc(x: number): number {
  const ax = Math.abs(x);
  let r: number;
  if (ax < 0.5) {
    const t = x * x;
    const p = [
      3.1611237438705655, 113.86415415105016, 377.485237685302, 3209.3775891384694,
      0.18577770618460315,
    ];
    const q = [23.601290952344122, 244.02463793444417, 1282.6165260773723, 2844.236833439171];
    const num = (((p[4] * t + p[0]) * t + p[1]) * t + p[2]) * t + p[3];
    const den = (((t + q[0]) * t + q[1]) * t + q[2]) * t + q[3];
    return 1 - (x * num) / den;
  }
  if (ax < 4) {
    const p = [
      0.5641884969886701, 8.883149794388375, 66.11919063714163, 298.6351381974001,
      881.952221241769, 1712.0476126340707, 2051.0783778260716, 1230.339354797997,
      2.1531153547440383e-8,
    ];
    const q = [
      15.744926110709835, 117.6939508913125, 537.1811018620099, 1621.3895745666903,
      3290.7992357334847, 4362.619090143247, 3439.3676741437216, 1230.3393548037495,
    ];
    let num = p[8] * ax;
    let den = ax;
    for (let i = 0; i < 7; i += 1) {
      num = (num + p[i]) * ax;
      den = (den + q[i]) * ax;
    }
    r = (num + p[7]) / (den + q[7]);
  } else {
    const p = [
      0.30532663496123236, 0.36034489994980445, 0.12578172611122926, 0.016083785148742275,
      0.0006587491615298367, 0.016315387137302097,
    ];
    const q = [
      2.5685201922898684, 1.8729528499234604, 0.5279051029514221, 0.060518341312441,
      0.0023352049762686918,
    ];
    const z = 1 / (ax * ax);
    let num = p[5] * z;
    let den = z;
    for (let i = 0; i < 4; i += 1) {
      num = (num + p[i]) * z;
      den = (den + q[i]) * z;
    }
    r = (z * (num + p[4])) / (den + q[4]);
    r = (1 / Math.sqrt(Math.PI) - r) / ax;
  }
  // exp(-x²) split to keep precision (Cody).
  const xs = Math.trunc(ax * 16) / 16;
  r *= Math.exp(-xs * xs) * Math.exp(-(ax - xs) * (ax + xs));
  return x < 0 ? 2 - r : r;
}

export const normalSf = (u: number) => 0.5 * erfc(u / Math.SQRT2);

function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function tSf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? tail : 1 - tail;
}

/**
 * The t quantile: t such that P(T ≤ t) = p, for 0 < p < 1 and df > 0
 * (bisection on the tail to ~1e-12; t_{0.975, 4} = 2.7764451…).
 */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return Number.NaN;
  if (p === 0.5) return 0;
  const upper = 1 - p; // P(T > t)
  const sign = upper < 0.5 ? 1 : -1;
  const target = Math.min(upper, 1 - upper);
  let lo = 0;
  let hi = 1;
  while (tSf(hi, df) > target) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-13 * Math.max(1, hi); i += 1) {
    const mid = (lo + hi) / 2;
    if (tSf(mid, df) > target) lo = mid;
    else hi = mid;
  }
  return sign * ((lo + hi) / 2);
}

/** Type-7 sample quantile of finite values (R default; numpy 'linear'). */
export function sampleQuantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
