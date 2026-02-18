/// <reference path="../.astro/types.d.ts" />

declare global {
  interface Window {
    Alpine?: {
      data: (name: string, factory: () => Record<string, unknown>) => void;
    };
  }
}

export {};
