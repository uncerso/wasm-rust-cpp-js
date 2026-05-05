#![cfg_attr(not(test), no_std)]

pub fn matmul_naive(a: &[f64], b: &[f64], c: &mut [f64], n: usize) {
    for x in c.iter_mut() {
        *x = 0.0;
    }
    for i in 0..n {
        for k in 0..n {
            let aik = a[i * n + k];
            for j in 0..n {
                c[i * n + j] += aik * b[k * n + j];
            }
        }
    }
}

#[must_use]
pub fn abs_sum(c: &[f64]) -> f64 {
    let mut s = 0.0_f64;
    for &x in c {
        s += x.abs();
    }
    s
}

#[cfg(test)]
#[allow(
    clippy::float_cmp,
    reason = "test inputs are exactly representable f64s (powers of 2 / small integers); strict equality is intentional"
)]
mod tests {
    use super::*;

    #[test]
    fn matmul_2x2_identity() {
        let i = [1.0, 0.0, 0.0, 1.0];
        let m = [2.0, 3.0, 4.0, 5.0];
        let mut c = [0.0; 4];
        matmul_naive(&i, &m, &mut c, 2);
        assert_eq!(c, [2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn matmul_resets_c() {
        let a = [1.0, 0.0, 0.0, 1.0];
        let b = [1.0, 0.0, 0.0, 1.0];
        let mut c = [99.0, 99.0, 99.0, 99.0];
        matmul_naive(&a, &b, &mut c, 2);
        assert_eq!(c, [1.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn abs_sum_basic() {
        let v = [-1.0, 2.0, -3.0];
        assert_eq!(abs_sum(&v), 6.0);
    }
}
