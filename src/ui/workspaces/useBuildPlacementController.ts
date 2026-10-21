import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BuildPlacementGhost,
  BuildPlacementStatus,
  BuildPlacementTool,
  GameClient,
  GridPoint,
} from "../../app/game-client/contracts.ts";
import {
  createBuildPlacementController,
  type BuildPlacementController,
} from "./buildPlacementController.ts";

export interface BuildPlacementState {
  readonly tool: BuildPlacementTool | null;
  readonly ghost: BuildPlacementGhost | null;
  readonly status: BuildPlacementStatus;
  readonly setTool: (tool: BuildPlacementTool | null) => void;
  readonly hover: (position: GridPoint | null) => void;
  readonly confirm: (position: GridPoint, retainTool: boolean) => void;
  readonly rotate: (direction: "clockwise" | "counterclockwise") => void;
  readonly cancel: () => void;
}

export function useBuildPlacementController(
  client: GameClient,
  interactive: boolean,
): BuildPlacementState {
  const controllerRef = useRef<BuildPlacementController | null>(null);
  const [tool, setToolState] = useState<BuildPlacementTool | null>(null);
  const [ghost, setGhost] = useState<BuildPlacementGhost | null>(null);
  const [status, setStatus] = useState<BuildPlacementStatus>("idle");

  useEffect(() => {
    const controller = createBuildPlacementController(client, {
      onGhost: (nextGhost) => {
        setGhost(nextGhost);
      },
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
      },
      onPlaced: (retainTool) => {
        if (!retainTool) setToolState(null);
      },
      onReset: () => {
        setToolState(null);
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
      setGhost(null);
      setStatus("idle");
    };
  }, [client]);

  useEffect(() => {
    controllerRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    if (!interactive) {
      controllerRef.current?.cancel();
    }
  }, [interactive]);

  const setTool = useCallback((nextTool: BuildPlacementTool | null) => {
    setToolState(nextTool);
  }, []);
  const hover = useCallback((position: GridPoint | null) => {
    controllerRef.current?.hover(position);
  }, []);
  const confirm = useCallback((position: GridPoint, retainTool: boolean) => {
    controllerRef.current?.confirm(position, retainTool);
  }, []);
  const rotate = useCallback((direction: "clockwise" | "counterclockwise") => {
    controllerRef.current?.rotate(direction);
  }, []);
  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
    setToolState(null);
  }, []);

  return { tool, ghost, status, setTool, hover, confirm, rotate, cancel };
}
