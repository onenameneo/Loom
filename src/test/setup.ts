class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });
}

// Radix Select uses pointer capture to keep the trigger interaction stable.
// jsdom does not implement the Pointer Events capture API, so provide the
// no-op surface needed by the primitive in renderer tests.
if ("HTMLElement" in globalThis) {
  const elementPrototype = HTMLElement.prototype as HTMLElement & {
    hasPointerCapture?: (pointerId: number) => boolean;
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
  };
  elementPrototype.hasPointerCapture ??= () => false;
  elementPrototype.setPointerCapture ??= () => undefined;
  elementPrototype.releasePointerCapture ??= () => undefined;
  elementPrototype.scrollIntoView ??= () => undefined;
}
