import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BuildMoveTarget,
  BuildPlacementGhost,
  BuildPlacementStatus,
  GameClient,
  GridPoint,
  Rotation,
} from "../../app/game-client/contracts.ts";
import {
  createBuildEditController,
  type BuildEditController,
  type BuildEditNotice,
} from "./buildEditController.ts";

export interface BuildEditState {
  readonly moveTarget: BuildMoveTarget | null;
  readonly ghost: BuildPlacementGhost | null;
  readonly status: BuildPlacementStatus;
  readonly notice: BuildEditNotice | null;
  readonly setMoveTarget: (target: BuildMoveTarget | null) => void;
  readonly hoverMove: (moduleInstanceId: string, position: GridPoint) => void;
  readonly confirmMove: (moduleInstanceId: string, position: GridPoint) => void;
  readonly rotateModule: (moduleInstanceId: string, rotation: Rotation) => void;
  readonly removeModules: (moduleInstanceIds: readonly string[]) => void;
  readonly disconnectRoutes: (routeIds: readonly string[]) => void;
  readonly history: (kind: "undo" | "redo") => void;
  readonly cancel: () => void;
}

export function useBuildEditController(client: GameClient, interactive: boolean): BuildEditState {
  const controllerRef = useRef<BuildEditController | null>(null);
  const [moveTarget, setMoveTargetState] = useState<BuildMoveTarget | null>(null);
  const [ghost, setGhost] = useState<BuildPlacementGhost | null>(null);
  const [status, setStatus] = useState<BuildPlacementStatus>("idle");
  const [notice, setNotice] = useState<BuildEditNotice | null>(null);

  useEffect(() => {
    const controller = createBuildEditController(client, {
      onGhost: (nextGhost) => {
        setGhost(nextGhost);
      },
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
      },
      onNotice: (nextNotice) => {
        setNotice(nextNotice);
      },
      onReset: () => {
        setMoveTargetState(null);
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
      setGhost(null);
      setStatus("idle");
      setNotice(null);
    };
  }, [client]);

  useEffect(() => {
    controllerRef.current?.setMoveTarget(moveTarget);
  }, [moveTarget]);

  useEffect(() => {
    if (!interactive) controllerRef.current?.cancel();
  }, [interactive]);

  const setMoveTarget = useCallback((target: BuildMoveTarget | null) => {
    setMoveTargetState(target);
  }, []);
  const hoverMove = useCallback((moduleInstanceId: string, position: GridPoint) => {
    controllerRef.current?.hoverMove(moduleInstanceId, position);
  }, []);
  const confirmMove = useCallback((moduleInstanceId: string, position: GridPoint) => {
    controllerRef.current?.confirmMove(moduleInstanceId, position);
  }, []);
  const rotateModule = useCallback((moduleInstanceId: string, rotation: Rotation) => {
    controllerRef.current?.rotateModule(moduleInstanceId, rotation);
  }, []);
  const removeModules = useCallback((moduleInstanceIds: readonly string[]) => {
    controllerRef.current?.removeModules(moduleInstanceIds);
  }, []);
  const disconnectRoutes = useCallback((routeIds: readonly string[]) => {
    controllerRef.current?.disconnectRoutes(routeIds);
  }, []);
  const history = useCallback((kind: "undo" | "redo") => {
    controllerRef.current?.history(kind);
  }, []);
  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setMoveTargetState(null);
  }, []);

  return {
    moveTarget,
    ghost,
    status,
    notice,
    setMoveTarget,
    hoverMove,
    confirmMove,
    rotateModule,
    removeModules,
    disconnectRoutes,
    history,
    cancel,
  };
}
