;; Mock multi-entry wasm fixture for raw-wasm loader tests.
;;
;; Exports cover two of the three loader dispatch paths:
;;   - matmul-style (arity 1, returns checksum from single call)
;;   - add-style    (arity 2, JS-side accumulator loop)
;;
;; The noop-style path (arity 0 + `_counter` export) is exercised by the real
;; interop_calls binaries in integration smoke (Task 22), not here.

(module
    (memory (export "memory") 1)
    ;; matmul-style: arity 1 → checksum = iters * 7
    (func $alpha (param $iters i32) (result i32)
        (i32.mul (local.get $iters) (i32.const 7)))
    ;; add-style: arity 2 → checksum = sum_{i in [0, iters)} (i + 2*i) = 3 * iters * (iters - 1) / 2
    (func $delta (param $a i32) (param $b i32) (result i32)
        (i32.add (local.get $a) (local.get $b)))
    ;; required loader infra (loadInput contract)
    (func $alloc (param $sz i32) (result i32) (i32.const 0))
    (func $load_input (param $ptr i32) (param $len i32))
    (export "alpha" (func $alpha))
    (export "delta" (func $delta))
    (export "alloc" (func $alloc))
    (export "load_input" (func $load_input)))
