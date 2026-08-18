import { Application } from "pixi.js";

import type {
  GridInteractionMode,
  GridIntent,
  PixiGridAdapter,
} from "../../app/game-client/contracts.ts";
import type { GridViewModel } from "../../app/game-client/snapshots.ts";

interface PendingSize {
  width: number;
  height: number;
  devicePixelRatio: number;
}

class EmptyPixiGridAdapter implements PixiGridAdapter {
  private application: Application | null = null;
  private container: HTMLElement | null = null;
  private generation = 0;
  private pendingSize: PendingSize | null = null;
  private readonly intentListeners = new Set<(intent: GridIntent) => void>();

  mount(container: HTMLElement): void {
    if (this.container !== null) {
      throw new Error("Pixi grid adapter is already mounted.");
    }

    this.container = container;
    const generation = ++this.generation;
    void this.initialize(generation);
  }

  private async initialize(generation: number): Promise<void> {
    const application = new Application();
    await application.init({
      width: 1,
      height: 1,
      antialias: false,
      autoDensity: true,
      autoStart: false,
      backgroundAlpha: 0,
      preference: "webgl",
      powerPreference: "low-power",
      resolution: 1,
    });

    if (this.container === null || generation !== this.generation) {
      application.destroy({ removeView: true }, { children: true });
      return;
    }

    this.application = application;
    application.canvas.dataset["pixiCanvas"] = "empty-grid";
    application.canvas.setAttribute("aria-label", "Empty facility grid canvas");
    application.canvas.style.display = "block";
    application.canvas.style.width = "100%";
    application.canvas.style.height = "100%";
    this.container.append(application.canvas);

    const size = this.pendingSize ?? {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
    };
    this.resize(size.width, size.height, size.devicePixelRatio);
  }

  update(viewModel: GridViewModel): void {
    void viewModel;
  }

  setInteractionMode(mode: GridInteractionMode): void {
    void mode;
  }

  setReducedEffects(enabled: boolean): void {
    void enabled;
  }

  subscribeIntents(listener: (intent: GridIntent) => void): () => void {
    this.intentListeners.add(listener);
    return () => {
      this.intentListeners.delete(listener);
    };
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    const size = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
      devicePixelRatio: Math.min(2, Math.max(1, devicePixelRatio)),
    };
    this.pendingSize = size;
    this.application?.renderer.resize(size.width, size.height, size.devicePixelRatio);
    this.application?.render();
  }

  destroy(): void {
    this.generation += 1;
    this.intentListeners.clear();
    this.application?.destroy({ removeView: true }, { children: true });
    this.application = null;
    this.container = null;
    this.pendingSize = null;
  }
}

export function createEmptyPixiGridAdapter(): PixiGridAdapter {
  return new EmptyPixiGridAdapter();
}
