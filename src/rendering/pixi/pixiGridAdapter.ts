import { Application, Container, Graphics } from "pixi.js";

import type {
  GridIntent,
  GridInteractionMode,
  PixiGridAdapter,
  PixiGridAdapterStatus,
} from "../../app/game-client/contracts.ts";
import type {
  GridModuleViewModel,
  GridRouteViewModel,
  GridViewModel,
} from "../../app/game-client/snapshots.ts";
import {
  clampCamera,
  fitCamera,
  panCamera,
  screenToGrid,
  screenToWorld,
  tileCenter,
  zoomAt,
  type CameraPoint,
  type CameraState,
  type CameraViewport,
} from "./camera.ts";
import { hitTestGrid } from "./hitTesting.ts";
import { createGridCoordinates, type GridCoordinates } from "./gridCoordinates.ts";
import { createRectanglePreview, type RectanglePreview } from "./rectanglePreview.ts";
import { reconcileKeyedScene, type KeyedScene } from "./sceneReconciliation.ts";
import { createModuleVisual, type ModuleVisual } from "./moduleVisual.ts";

const DEFAULT_GRID_SIZE = { width: 24, height: 16 } as const;
const POINTER_DRAG_THRESHOLD = 4;
const INITIAL_VIEWPORT: CameraViewport = { width: 1, height: 1 };

type SceneLayerName =
  "grid" | "heat" | "routes" | "modules" | "ports" | "selection" | "ghost" | "effects";

interface PointerGesture {
  readonly pointerId: number;
  readonly button: number;
  readonly start: CameraPoint;
  readonly startTile: CameraPoint | null;
  last: CameraPoint;
  dragged: boolean;
  pan: boolean;
}

interface PixiGridAdapterInternals {
  readonly application: Application;
  readonly canvas: HTMLCanvasElement;
  readonly worldRoot: Container;
  readonly layers: Readonly<Record<SceneLayerName, Container>>;
  readonly rectanglePreview: RectanglePreview;
  readonly coordinates: GridCoordinates;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function moduleGeometrySignature(module: GridModuleViewModel): string {
  return [
    module.id,
    module.definitionId,
    module.spriteKey,
    module.position.x,
    module.position.y,
    module.footprint.width,
    module.footprint.height,
    module.rotation,
    module.ports
      .map((port) => `${port.portId}:${port.adjacentTile.x},${port.adjacentTile.y}`)
      .join("|"),
  ].join("/");
}

function routeGeometrySignature(route: GridRouteViewModel): string {
  return [route.id, route.kind, route.path.map((point) => `${point.x},${point.y}`).join(";")].join(
    "/",
  );
}

function routeVisualSignature(route: GridRouteViewModel): string {
  return [routeGeometrySignature(route), route.selected, route.utilizationRatio === null].join("/");
}

function destroyChildren(container: Container): void {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true, context: true });
  }
}

function destroyApplication(application: Application): void {
  // Pixi initializes application plugins only after renderer admission. Calling
  // Application.destroy before that admission invokes uninitialized plugin cleanup.
  if ((application as Partial<Application>).renderer === undefined)
    application.stage.destroy({ children: true, context: true });
  else application.destroy({ removeView: true }, { children: true, context: true });
}

function sortModules(modules: readonly GridModuleViewModel[]): readonly GridModuleViewModel[] {
  return [...modules].toSorted((left, right) => left.id.localeCompare(right.id));
}

function sortRoutes(routes: readonly GridRouteViewModel[]): readonly GridRouteViewModel[] {
  return [...routes].toSorted((left, right) => left.id.localeCompare(right.id));
}

function sceneFromGrid(grid: GridViewModel): KeyedScene {
  return {
    modules: new Map(
      sortModules(grid.modules).map((module) => [module.id, moduleGeometrySignature(module)]),
    ),
    routes: new Map(
      sortRoutes(grid.routes).map((route) => [route.id, routeGeometrySignature(route)]),
    ),
  };
}

function localPointer(
  canvas: HTMLCanvasElement,
  event: PointerEvent | WheelEvent,
  viewport: CameraViewport,
): CameraPoint {
  const bounds = canvas.getBoundingClientRect();
  const scaleX = bounds.width > 0 ? viewport.width / bounds.width : 1;
  const scaleY = bounds.height > 0 ? viewport.height / bounds.height : 1;
  return {
    x: (event.clientX - bounds.left) * scaleX,
    y: (event.clientY - bounds.top) * scaleY,
  };
}

function samePoint(left: CameraPoint | null, right: CameraPoint | null): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

function selectedTile(entityId: string | null, grid: GridViewModel): CameraPoint | null {
  if (entityId === null) return null;
  const match = /^tile:(\d+):(\d+)$/.exec(entityId);
  if (match === null) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return x >= 0 && y >= 0 && x < grid.gridSize.width && y < grid.gridSize.height ? { x, y } : null;
}

function createLayers(worldRoot: Container): Readonly<Record<SceneLayerName, Container>> {
  const names: readonly SceneLayerName[] = [
    "grid",
    "heat",
    "routes",
    "modules",
    "ports",
    "selection",
    "ghost",
    "effects",
  ];
  const layers = {} as Record<SceneLayerName, Container>;
  for (const name of names) {
    const layer = new Container({ label: `facility-${name}` });
    layers[name] = layer;
    worldRoot.addChild(layer);
  }
  return layers;
}

export function createPixiGridAdapter(): PixiGridAdapter {
  let container: HTMLElement | null = null;
  let internals: PixiGridAdapterInternals | null = null;
  let generation = 0;
  let currentModel: GridViewModel | null = null;
  let currentScene: KeyedScene = { modules: new Map(), routes: new Map() };
  let viewport: CameraViewport = INITIAL_VIEWPORT;
  let devicePixelRatio = 1;
  let camera: CameraState = { centerWorld: { x: 384, y: 256 }, zoom: 1 };
  let reportedCamera: CameraState | null = null;
  let interactionMode: GridInteractionMode = { kind: "select" };
  let reducedEffects = false;
  let inputEnabled = true;
  let pointerGesture: PointerGesture | null = null;
  let hoveredTile: CameraPoint | null = null;
  let keyboardCursor: CameraPoint = { x: 0, y: 0 };
  let keyboardCursorVisible = false;
  let selectedEntityIds: readonly string[] = [];
  let inspectedEntityId: string | null = null;
  let renderHandle: number | null = null;
  let frameCap: 30 | 45 | 60 = 60;
  let nextRenderAt: number | null = null;
  let status: PixiGridAdapterStatus = "initializing";
  const statusListeners = new Set<(value: PixiGridAdapterStatus) => void>();
  const intentListeners = new Set<(intent: GridIntent) => void>();
  const moduleContainers = new Map<string, Container>();
  const routeContainers = new Map<string, Container>();
  const moduleVisuals = new Map<string, ModuleVisual>();
  let moduleLabels: Readonly<Record<string, string>> = {};
  const routeVisuals = new Map<string, string>();
  let gridSignature: string | null = null;
  let portSignature: string | null = null;
  let selectionSignature: string | null = null;
  let cameraSignature: string | null = null;
  const heatCells = new Map<string, { graphic: Graphics; temperatureC: number }>();
  const diagnostics = {
    moduleCreated: 0,
    moduleUpdated: 0,
    moduleRemoved: 0,
    routeCreated: 0,
    routeUpdated: 0,
    routeRemoved: 0,
    gridUpdated: 0,
    portsUpdated: 0,
    selectionUpdated: 0,
    heatCellsUpdated: 0,
    renderCount: 0,
  };

  const setStatus = (next: PixiGridAdapterStatus): void => {
    status = next;
    for (const listener of statusListeners) listener(next);
  };

  const emit = (intent: GridIntent): void => {
    for (const listener of intentListeners) listener(intent);
  };

  const scheduleRender = (): void => {
    if (renderHandle !== null || internals === null || document.hidden) return;
    renderHandle = window.requestAnimationFrame((timestamp) => {
      renderHandle = null;
      if (internals === null || document.hidden) return;
      if (nextRenderAt !== null && timestamp < nextRenderAt) {
        scheduleRender();
        return;
      }
      internals.application.renderer.render(internals.application.stage);
      diagnostics.renderCount += 1;
      const interval = 1000 / frameCap;
      // Carry the fractional deadline across display frames, but never catch up
      // missed frames after a hitch/hidden interval with a submission burst.
      nextRenderAt =
        nextRenderAt === null || timestamp - nextRenderAt >= interval
          ? timestamp + interval
          : nextRenderAt + interval;
    });
  };

  const applyCamera = (): void => {
    if (internals === null) return;
    const nextSignature = [
      viewport.width,
      viewport.height,
      camera.centerWorld.x,
      camera.centerWorld.y,
      camera.zoom,
      currentModel?.gridSize.width,
      currentModel?.gridSize.height,
    ].join("/");
    if (cameraSignature === nextSignature) return;
    cameraSignature = nextSignature;
    internals.worldRoot.position.set(
      viewport.width / 2 - camera.centerWorld.x * camera.zoom,
      viewport.height / 2 - camera.centerWorld.y * camera.zoom,
    );
    internals.worldRoot.scale.set(camera.zoom);
    if (currentModel !== null)
      internals.coordinates.update(currentModel.gridSize, camera, viewport);
    if (
      reportedCamera?.zoom !== camera.zoom ||
      reportedCamera.centerWorld.x !== camera.centerWorld.x ||
      reportedCamera.centerWorld.y !== camera.centerWorld.y
    ) {
      reportedCamera = camera;
      emit({ kind: "CAMERA_CHANGED", centerWorld: camera.centerWorld, zoom: camera.zoom });
    }
    scheduleRender();
  };

  const clearScene = (): void => {
    for (const layer of Object.values(internals?.layers ?? {})) destroyChildren(layer);
    moduleContainers.clear();
    routeContainers.clear();
    moduleVisuals.clear();
    routeVisuals.clear();
    currentScene = { modules: new Map(), routes: new Map() };
    gridSignature = null;
    portSignature = null;
    selectionSignature = null;
    cameraSignature = null;
    heatCells.clear();
  };

  const drawGrid = (): void => {
    if (internals === null || currentModel === null) return;
    const layer = internals.layers.grid;
    const nextSignature = `${currentModel.gridSize.width}/${currentModel.gridSize.height}`;
    if (gridSignature === nextSignature) return;
    gridSignature = nextSignature;
    const graphics =
      layer.children[0] instanceof Graphics
        ? layer.children[0].clear()
        : layer.addChild(new Graphics());
    const width = currentModel.gridSize.width * 32;
    const height = currentModel.gridSize.height * 32;
    graphics.rect(0, 0, width, height).fill({ color: 0x0d1522, alpha: 0.98 });
    graphics
      .rect(0, 0, width, height)
      .stroke({ color: 0x263c4b, width: 1, alpha: 0.9, pixelLine: true });
    for (let x = 0; x <= currentModel.gridSize.width; x += 1) {
      graphics.moveTo(x * 32, 0).lineTo(x * 32, height);
    }
    for (let y = 0; y <= currentModel.gridSize.height; y += 1) {
      graphics.moveTo(0, y * 32).lineTo(width, y * 32);
    }
    graphics.stroke({ color: 0x1c2b39, width: 1, alpha: 0.8, pixelLine: true });
    diagnostics.gridUpdated += 1;
    scheduleRender();
  };

  const drawRoute = (route: GridRouteViewModel, target: Container): void => {
    destroyChildren(target);
    const path = new Graphics();
    const first = route.path[0];
    if (first === undefined) return;
    path.moveTo(tileCenter(first).x, tileCenter(first).y);
    for (const point of route.path.slice(1)) {
      path.lineTo(tileCenter(point).x, tileCenter(point).y);
    }
    path.stroke({
      color: route.kind === "power" ? 0xf0b34d : 0x74b8ee,
      width: route.selected ? 5 : 3,
      alpha: route.utilizationRatio === null ? 0.55 : 0.92,
    });
    target.addChild(path);
  };

  const drawPorts = (): void => {
    if (internals === null || currentModel === null) return;
    const layer = internals.layers.ports;
    const modules = sortModules(currentModel.modules);
    const nextSignature = modules
      .map((module) =>
        module.ports
          .map((port) => `${port.kind}:${port.adjacentTile.x},${port.adjacentTile.y}`)
          .join(";"),
      )
      .join("/");
    if (portSignature === nextSignature) return;
    portSignature = nextSignature;
    const graphics =
      layer.children[0] instanceof Graphics
        ? layer.children[0].clear()
        : layer.addChild(new Graphics());
    for (const module of modules) {
      for (const port of module.ports) {
        const point = tileCenter(port.adjacentTile);
        graphics
          .circle(point.x, point.y, 5)
          .fill({ color: port.kind.startsWith("power") ? 0xf0b34d : 0x74b8ee, alpha: 0.9 });
        graphics.circle(point.x, point.y, 7).stroke({ color: 0xe9f0f3, width: 1, alpha: 0.7 });
      }
    }
    diagnostics.portsUpdated += 1;
    scheduleRender();
  };

  const drawSelection = (): void => {
    if (internals === null || currentModel === null) return;
    if (!inputEnabled) {
      if (selectionSignature !== "disabled") {
        selectionSignature = "disabled";
        const graphic = internals.layers.selection.children[0];
        if (graphic instanceof Graphics) graphic.clear();
        diagnostics.selectionUpdated += 1;
        scheduleRender();
      }
      return;
    }
    const model = currentModel;
    const layer = internals.layers.selection;
    const selected = new Set(selectedEntityIds);
    const nextSignature = [
      model.modules
        .filter((module) => module.selected || selected.has(module.id))
        .map(moduleGeometrySignature)
        .join(";"),
      model.routes
        .filter((route) => route.selected || selected.has(route.id))
        .map(routeGeometrySignature)
        .join(";"),
      selectedEntityIds.join(";"),
      inspectedEntityId,
      model.gridSize.width,
      model.gridSize.height,
      keyboardCursorVisible,
      keyboardCursor.x,
      keyboardCursor.y,
    ].join("/");
    if (selectionSignature === nextSignature) return;
    selectionSignature = nextSignature;
    const graphics =
      layer.children[0] instanceof Graphics
        ? layer.children[0].clear()
        : layer.addChild(new Graphics());
    for (const module of currentModel.modules) {
      if (!module.selected && !selected.has(module.id)) continue;
      graphics
        .roundRect(
          module.position.x * 32 - 3,
          module.position.y * 32 - 3,
          module.footprint.width * 32 + 6,
          module.footprint.height * 32 + 6,
          7,
        )
        .stroke({ color: 0xf4e285, width: 2, alpha: 0.95 });
    }
    for (const route of currentModel.routes) {
      if (!route.selected && !selected.has(route.id)) continue;
      for (let index = 1; index < route.path.length; index += 1) {
        const start = route.path[index - 1];
        const end = route.path[index];
        if (start === undefined || end === undefined) continue;
        graphics
          .moveTo(tileCenter(start).x, tileCenter(start).y)
          .lineTo(tileCenter(end).x, tileCenter(end).y);
      }
    }
    const selectedTiles = selectedEntityIds
      .map((entityId) => selectedTile(entityId, model))
      .filter((tile): tile is CameraPoint => tile !== null);
    const inspectedTile = selectedTile(inspectedEntityId, model);
    if (selectedTiles.length === 0 && inspectedTile !== null) selectedTiles.push(inspectedTile);
    for (const tile of selectedTiles) {
      graphics
        .rect(tile.x * 32 + 3, tile.y * 32 + 3, 26, 26)
        .stroke({ color: 0x63cbd1, width: 2, alpha: 0.95 });
    }
    if (
      keyboardCursorVisible &&
      keyboardCursor.x >= 0 &&
      keyboardCursor.y >= 0 &&
      keyboardCursor.x < currentModel.gridSize.width &&
      keyboardCursor.y < currentModel.gridSize.height
    ) {
      graphics
        .rect(keyboardCursor.x * 32 + 3, keyboardCursor.y * 32 + 3, 26, 26)
        .stroke({ color: 0xf4e285, width: 1, alpha: 0.9 });
    }
    graphics.stroke({ color: 0xf4e285, width: 7, alpha: 0.22 });
    diagnostics.selectionUpdated += 1;
    scheduleRender();
  };

  const drawHeat = (): void => {
    if (internals === null || currentModel === null) return;
    const layer = internals.layers.heat;
    const values =
      currentModel.heatmap === null || reducedEffects ? [] : currentModel.heatmap.values;
    const keys = new Set<string>();
    for (const patch of values) {
      const key = `${patch.x}:${patch.y}`;
      keys.add(key);
      const retained = heatCells.get(key);
      if (retained?.temperatureC === patch.temperatureC) continue;
      const graphics = retained?.graphic ?? layer.addChild(new Graphics());
      graphics.clear();
      const intensity = Math.min(1, Math.max(0, (patch.temperatureC - 20) / 100));
      graphics
        .rect(patch.x * 32 + 3, patch.y * 32 + 3, 26, 26)
        .fill({ color: 0xe24e33, alpha: intensity * 0.28 });
      heatCells.set(key, { graphic: graphics, temperatureC: patch.temperatureC });
      diagnostics.heatCellsUpdated += 1;
      scheduleRender();
    }
    for (const [key, cell] of heatCells)
      if (!keys.has(key)) {
        cell.graphic.destroy({ context: true });
        heatCells.delete(key);
        diagnostics.heatCellsUpdated += 1;
        scheduleRender();
      }
  };

  const reconcile = (): void => {
    if (internals === null || currentModel === null) return;
    const nextScene = sceneFromGrid(currentModel);
    const result = reconcileKeyedScene(currentScene, nextScene);
    currentScene = result.scene;

    for (const id of result.changes.modules.removed) {
      const target = moduleContainers.get(id);
      target?.destroy({ children: true, context: true });
      moduleContainers.delete(id);
      moduleVisuals.delete(id);
      diagnostics.moduleRemoved += 1;
      scheduleRender();
    }
    for (const id of result.changes.modules.created) {
      const target = new Container({ label: `module-${id}` });
      moduleContainers.set(id, target);
      internals.layers.modules.addChild(target);
      diagnostics.moduleCreated += 1;
    }
    for (const module of sortModules(currentModel.modules)) {
      const target = moduleContainers.get(module.id);
      if (target === undefined) continue;
      const label = moduleLabels[module.definitionId] ?? module.definitionId;
      const retained = moduleVisuals.get(module.id);
      if (retained === undefined) {
        moduleVisuals.set(module.id, createModuleVisual(module, label, target));
        scheduleRender();
      } else if (retained.update(module, label)) {
        diagnostics.moduleUpdated += 1;
        scheduleRender();
      }
    }

    for (const id of result.changes.routes.removed) {
      const target = routeContainers.get(id);
      target?.destroy({ children: true, context: true });
      routeContainers.delete(id);
      routeVisuals.delete(id);
      diagnostics.routeRemoved += 1;
      scheduleRender();
    }
    for (const id of result.changes.routes.created) {
      const target = new Container({ label: `route-${id}` });
      routeContainers.set(id, target);
      internals.layers.routes.addChild(target);
      diagnostics.routeCreated += 1;
    }
    for (const route of sortRoutes(currentModel.routes)) {
      const visual = routeVisualSignature(route);
      const target = routeContainers.get(route.id);
      if (target !== undefined && routeVisuals.get(route.id) !== visual) {
        if (routeVisuals.has(route.id)) diagnostics.routeUpdated += 1;
        drawRoute(route, target);
        routeVisuals.set(route.id, visual);
        scheduleRender();
      }
    }
    drawPorts();
    drawSelection();
    drawHeat();
    applyCamera();
  };

  const pointerPosition = (event: PointerEvent | WheelEvent): CameraPoint => {
    if (internals === null) return { x: 0, y: 0 };
    return localPointer(internals.canvas, event, viewport);
  };

  const cancelGesture = (): void => {
    const gesture = pointerGesture;
    pointerGesture = null;
    if (gesture !== null && internals?.canvas.hasPointerCapture(gesture.pointerId)) {
      internals.canvas.releasePointerCapture(gesture.pointerId);
    }
    internals?.rectanglePreview.clear();
    scheduleRender();
  };

  const dragEndpoint = (point: CameraPoint): CameraPoint => {
    const world = screenToWorld(point, viewport, camera);
    const size = currentModel?.gridSize ?? DEFAULT_GRID_SIZE;
    return {
      x: Math.max(0, Math.min(size.width - 1, Math.floor(world.x / 32))),
      y: Math.max(0, Math.min(size.height - 1, Math.floor(world.y / 32))),
    };
  };

  const updateCamera = (next: CameraState): void => {
    camera = next;
    applyCamera();
  };

  const selectEntity = (target: ReturnType<typeof hitTestGrid>, additive: boolean): void => {
    if (target === null) {
      emit({ kind: "SELECT_ENTITY", entityId: null, additive });
      return;
    }
    if (target.kind === "module" || target.kind === "port") {
      emit({ kind: "SELECT_ENTITY", entityId: target.moduleInstanceId, additive });
    } else if (target.kind === "route") {
      emit({ kind: "SELECT_ENTITY", entityId: target.routeId, additive });
    } else {
      emit({
        kind: "SELECT_ENTITY",
        entityId: `tile:${target.position.x}:${target.position.y}`,
        additive,
      });
    }
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (!inputEnabled || currentModel === null || event.button > 1 || pointerGesture !== null)
      return;
    if (keyboardCursorVisible) {
      keyboardCursorVisible = false;
      drawSelection();
      scheduleRender();
    }
    const pan = event.button === 1 || interactionMode.kind === "pan";
    pointerGesture = {
      pointerId: event.pointerId,
      button: event.button,
      start: pointerPosition(event),
      startTile: screenToGrid(pointerPosition(event), viewport, camera, currentModel.gridSize),
      last: pointerPosition(event),
      dragged: false,
      pan,
    };
    internals?.canvas.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!inputEnabled || currentModel === null) return;
    const point = pointerPosition(event);
    const gridPoint = screenToGrid(point, viewport, camera, currentModel.gridSize);
    if (!samePoint(hoveredTile, gridPoint)) {
      hoveredTile = gridPoint;
      emit({ kind: "HOVER_TILE", position: gridPoint });
    }
    if (pointerGesture?.pointerId !== event.pointerId) return;
    const delta = { x: point.x - pointerGesture.last.x, y: point.y - pointerGesture.last.y };
    const total = Math.hypot(point.x - pointerGesture.start.x, point.y - pointerGesture.start.y);
    if (total > POINTER_DRAG_THRESHOLD) pointerGesture.dragged = true;
    if (pointerGesture.pan && (delta.x !== 0 || delta.y !== 0)) {
      updateCamera(panCamera(camera, delta, viewport, currentModel.gridSize));
    } else if (
      !pointerGesture.pan &&
      pointerGesture.button === 0 &&
      pointerGesture.dragged &&
      pointerGesture.startTile !== null
    ) {
      internals?.rectanglePreview.update(
        pointerGesture.startTile,
        dragEndpoint(point),
        currentModel.gridSize,
      );
      scheduleRender();
    }
    pointerGesture.last = point;
  };

  const handlePointerUp = (event: PointerEvent): void => {
    if (pointerGesture?.pointerId !== event.pointerId || currentModel === null) return;
    const gesture = pointerGesture;
    const point = pointerPosition(event);
    if (gesture.dragged && !gesture.pan && gesture.button === 0) {
      const from = gesture.startTile;
      const to = dragEndpoint(point);
      if (from !== null) {
        emit({ kind: "SELECT_RECT", from, to, additive: false });
      }
    } else if (!gesture.dragged && gesture.button === 0 && interactionMode.kind === "select") {
      const target = hitTestGrid(currentModel, point, viewport, camera);
      selectEntity(target, target !== null && target.kind !== "tile");
    }
    cancelGesture();
  };

  const handleWheel = (event: WheelEvent): void => {
    if (!inputEnabled || currentModel === null || internals === null) return;
    event.preventDefault();
    cancelGesture();
    const point = pointerPosition(event);
    const factor = Math.exp(-event.deltaY * 0.0015);
    updateCamera(zoomAt(camera, point, factor, viewport, currentModel.gridSize));
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!inputEnabled || currentModel === null || internals === null) return;
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      cancelGesture();
      updateCamera(fitCamera(currentModel.gridSize, viewport));
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      cancelGesture();
      updateCamera(
        zoomAt(
          camera,
          { x: viewport.width / 2, y: viewport.height / 2 },
          1.2,
          viewport,
          currentModel.gridSize,
        ),
      );
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      cancelGesture();
      updateCamera(
        zoomAt(
          camera,
          { x: viewport.width / 2, y: viewport.height / 2 },
          1 / 1.2,
          viewport,
          currentModel.gridSize,
        ),
      );
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (pointerGesture !== null) {
        cancelGesture();
        return;
      }
      emit({ kind: "SELECT_ENTITY", entityId: null, additive: false });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      emit({
        kind: "SELECT_ENTITY",
        entityId: `tile:${keyboardCursor.x}:${keyboardCursor.y}`,
        additive: false,
      });
      return;
    }
    const movement: Record<string, CameraPoint> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const delta = movement[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      keyboardCursorVisible = true;
      keyboardCursor = {
        x: Math.min(currentModel.gridSize.width - 1, Math.max(0, keyboardCursor.x + delta.x)),
        y: Math.min(currentModel.gridSize.height - 1, Math.max(0, keyboardCursor.y + delta.y)),
      };
      hoveredTile = keyboardCursor;
      emit({ kind: "HOVER_TILE", position: keyboardCursor });
      drawSelection();
      scheduleRender();
    }
  };

  const handleVisibility = (): void => {
    if (document.hidden) {
      if (renderHandle !== null) window.cancelAnimationFrame(renderHandle);
      renderHandle = null;
      nextRenderAt = null;
      cancelGesture();
    } else {
      scheduleRender();
    }
  };

  const attachCanvasListeners = (): void => {
    if (internals === null) return;
    const canvas = internals.canvas;
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", cancelGesture);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    window.addEventListener("blur", cancelGesture);
    document.addEventListener("visibilitychange", handleVisibility);
  };

  const detachCanvasListeners = (): void => {
    if (internals === null) return;
    const canvas = internals.canvas;
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", cancelGesture);
    canvas.removeEventListener("wheel", handleWheel);
    canvas.removeEventListener("keydown", handleKeyDown);
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    window.removeEventListener("blur", cancelGesture);
    document.removeEventListener("visibilitychange", handleVisibility);
  };

  const disposeApplication = (): void => {
    cancelGesture();
    if (renderHandle !== null) window.cancelAnimationFrame(renderHandle);
    renderHandle = null;
    nextRenderAt = null;
    if (internals !== null) {
      detachCanvasListeners();
      clearScene();
      internals.application.destroy({ removeView: true }, { children: true, context: true });
      internals = null;
    }
  };

  async function initialize(expectedGeneration: number): Promise<void> {
    const host = container;
    if (host === null || expectedGeneration !== generation) return;
    setStatus("initializing");
    const application = new Application();
    try {
      await application.init({
        width: 1,
        height: 1,
        antialias: false,
        autoDensity: true,
        autoStart: false,
        backgroundAlpha: 0,
        preference: "webgl",
        powerPreference: "low-power",
        resolution: devicePixelRatio,
      });
      if (expectedGeneration !== generation || container !== host) {
        destroyApplication(application);
        return;
      }
      const canvas = application.canvas;
      canvas.dataset["pixiCanvas"] = "facility-grid";
      canvas.setAttribute("aria-label", "Facility grid canvas");
      canvas.tabIndex = 0;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      host.replaceChildren(canvas);
      const worldRoot = new Container({ label: "facility-world" });
      application.stage.addChild(worldRoot);
      const layers = createLayers(worldRoot);
      const rectanglePreview = createRectanglePreview();
      worldRoot.addChildAt(rectanglePreview.container, worldRoot.getChildIndex(layers.ghost));
      const coordinates = createGridCoordinates();
      application.stage.addChild(coordinates.container);
      internals = { application, canvas, worldRoot, layers, rectanglePreview, coordinates };
      attachCanvasListeners();
      application.renderer.resize(viewport.width, viewport.height, devicePixelRatio);
      camera = clampCamera(camera, viewport, currentModel?.gridSize ?? DEFAULT_GRID_SIZE);
      applyCamera();
      setStatus("ready");
      if (currentModel !== null) {
        drawGrid();
        reconcile();
      }
      scheduleRender();
    } catch {
      if (internals?.application === application) disposeApplication();
      else destroyApplication(application);
      if (expectedGeneration === generation && container === host) setStatus("error");
    }
  }

  function handleContextLost(event: Event): void {
    event.preventDefault();
    setStatus("context-lost");
    void recreateAfterContextLoss();
  }

  function handleContextRestored(): void {
    if (status === "context-lost") setStatus("initializing");
  }

  async function recreateAfterContextLoss(): Promise<void> {
    if (container === null) return;
    const expectedGeneration = ++generation;
    disposeApplication();
    await initialize(expectedGeneration);
  }

  const adapter: PixiGridAdapter = {
    mount(nextContainer) {
      if (container !== null) throw new Error("Pixi grid adapter is already mounted.");
      container = nextContainer;
      generation += 1;
      void initialize(generation);
    },
    update(viewModel) {
      if (
        currentModel !== null &&
        (currentModel.layoutRevision !== viewModel.layoutRevision ||
          currentModel.mode !== viewModel.mode ||
          currentModel.gridSize.width !== viewModel.gridSize.width ||
          currentModel.gridSize.height !== viewModel.gridSize.height)
      )
        cancelGesture();
      currentModel = viewModel;
      camera = clampCamera(camera, viewport, currentModel.gridSize);
      keyboardCursor = {
        x: Math.min(currentModel.gridSize.width - 1, Math.max(0, keyboardCursor.x)),
        y: Math.min(currentModel.gridSize.height - 1, Math.max(0, keyboardCursor.y)),
      };
      if (internals !== null) {
        drawGrid();
        reconcile();
      }
    },
    setInteractionMode(mode) {
      cancelGesture();
      interactionMode = mode;
    },
    setInputEnabled(enabled) {
      if (inputEnabled === enabled) return;
      inputEnabled = enabled;
      cancelGesture();
      if (!enabled) {
        selectedEntityIds = [];
        inspectedEntityId = null;
        keyboardCursorVisible = false;
      }
      drawSelection();
    },
    setSelectedEntities(entityIds) {
      const next = [...new Set(entityIds)].toSorted();
      if (
        next.length === selectedEntityIds.length &&
        next.every((id, index) => id === selectedEntityIds[index])
      )
        return;
      selectedEntityIds = next;
      drawSelection();
      scheduleRender();
    },
    setInspectedEntity(entityId) {
      if (inspectedEntityId === entityId) return;
      inspectedEntityId = entityId;
      drawSelection();
      scheduleRender();
    },
    setReducedEffects(enabled) {
      if (reducedEffects === enabled) return;
      reducedEffects = enabled;
      drawHeat();
      scheduleRender();
    },
    setFrameCap(cap) {
      if (frameCap === cap) return;
      frameCap = cap;
      nextRenderAt = null;
      scheduleRender();
    },
    setModuleLabels(labels) {
      moduleLabels = { ...labels };
      if (internals !== null && currentModel !== null) reconcile();
    },
    subscribeIntents(listener) {
      intentListeners.add(listener);
      return () => intentListeners.delete(listener);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    getStatus() {
      return status;
    },
    getDiagnostics() {
      return {
        initialized: internals !== null,
        liveCanvasCount: internals === null ? 0 : 1,
        listenerCount: internals === null ? 0 : 11,
        cachedTextureCount: 0,
        frameCap,
        ...diagnostics,
      };
    },
    zoomIn() {
      if (currentModel === null) return;
      cancelGesture();
      updateCamera(
        zoomAt(
          camera,
          { x: viewport.width / 2, y: viewport.height / 2 },
          1.2,
          viewport,
          currentModel.gridSize,
        ),
      );
    },
    zoomOut() {
      if (currentModel === null) return;
      cancelGesture();
      updateCamera(
        zoomAt(
          camera,
          { x: viewport.width / 2, y: viewport.height / 2 },
          1 / 1.2,
          viewport,
          currentModel.gridSize,
        ),
      );
    },
    fit() {
      if (currentModel === null) return;
      cancelGesture();
      updateCamera(fitCamera(currentModel.gridSize, viewport));
    },
    retry() {
      if (container === null) return;
      const expectedGeneration = ++generation;
      disposeApplication();
      void initialize(expectedGeneration);
    },
    resize(width, height, nextDevicePixelRatio) {
      cancelGesture();
      viewport = {
        width: finitePositive(width, 1),
        height: finitePositive(height, 1),
      };
      devicePixelRatio = Math.min(2, Math.max(1, finitePositive(nextDevicePixelRatio, 1)));
      if (internals !== null) {
        internals.application.renderer.resize(viewport.width, viewport.height, devicePixelRatio);
        if (currentModel !== null) camera = clampCamera(camera, viewport, currentModel.gridSize);
        applyCamera();
        scheduleRender();
      }
    },
    destroy() {
      generation += 1;
      disposeApplication();
      if (container !== null) container.replaceChildren();
      container = null;
      currentModel = null;
      selectedEntityIds = [];
      inspectedEntityId = null;
      keyboardCursorVisible = false;
      currentScene = { modules: new Map(), routes: new Map() };
      statusListeners.clear();
      intentListeners.clear();
    },
  };

  return adapter;
}
