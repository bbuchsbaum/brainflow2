//! Distribution tails and special functions used by the inference methods.
//!
//! Implemented on `libm` (`erfc`, `lgamma`) and a continued-fraction
//! regularized incomplete beta; checked against scipy.stats in the tests.

/// Natural log of the gamma function.
pub fn ln_gamma(x: f64) -> f64 {
    libm::lgamma(x)
}

/// Upper tail of the standard normal, `1 - Φ(u)`.
pub fn normal_sf(u: f64) -> f64 {
    0.5 * libm::erfc(u / std::f64::consts::SQRT_2)
}

/// Continued fraction for the regularized incomplete beta (modified Lentz).
fn beta_continued_fraction(a: f64, b: f64, x: f64) -> f64 {
    const TINY: f64 = 1e-300;
    const EPS: f64 = 1e-15;
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < TINY {
        d = TINY;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..=500 {
        let m = m as f64;
        let m2 = 2.0 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < TINY {
            d = TINY;
        }
        c = 1.0 + aa / c;
        if c.abs() < TINY {
            c = TINY;
        }
        d = 1.0 / d;
        h *= d * c;
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < TINY {
            d = TINY;
        }
        c = 1.0 + aa / c;
        if c.abs() < TINY {
            c = TINY;
        }
        d = 1.0 / d;
        let delta = d * c;
        h *= delta;
        if (delta - 1.0).abs() < EPS {
            break;
        }
    }
    h
}

/// Regularized incomplete beta function `I_x(a, b)`.
pub fn incomplete_beta(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let front =
        (ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b) + a * x.ln() + b * (1.0 - x).ln()).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        front * beta_continued_fraction(a, b, x) / a
    } else {
        1.0 - front * beta_continued_fraction(b, a, 1.0 - x) / b
    }
}

/// Upper tail of Student's t with `df` degrees of freedom, `P(T > t)`.
pub fn t_sf(t: f64, df: f64) -> f64 {
    let tail = 0.5 * incomplete_beta(df / 2.0, 0.5, df / (df + t * t));
    if t >= 0.0 {
        tail
    } else {
        1.0 - tail
    }
}

/// Upper tail of the F distribution with `df1`, `df2` degrees of freedom,
/// `P(F > f)`.
pub fn f_sf(f: f64, df1: f64, df2: f64) -> f64 {
    if f <= 0.0 {
        return 1.0;
    }
    incomplete_beta(df2 / 2.0, df1 / 2.0, df2 / (df2 + df1 * f))
}
