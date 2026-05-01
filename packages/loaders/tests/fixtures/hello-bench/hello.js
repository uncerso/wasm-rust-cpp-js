// Минимальный bench module: просто возвращает фиксированную checksum.
export default function create() {
  let lastInput = null;
  return {
    loadInput(buf) { lastInput = buf; },
    run(_iters) { return { checksum: 42 }; },
    readOutput() { return lastInput ?? new Uint8Array(); },
  };
}
