"use client";

import { createContext, useContext } from "react";
import type { Placement } from "./editorDock";

type OutputLayout = {
  host: HTMLElement;
  detached: boolean;
  narrow: boolean;
  move: (placement: Placement) => void;
  attach: () => void;
  showSource: () => void;
};

export const OutputLayoutContext = createContext<OutputLayout | null>(null);
export const useOutputLayout = () => useContext(OutputLayoutContext);
