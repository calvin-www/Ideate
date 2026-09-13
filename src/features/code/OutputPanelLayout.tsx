"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOutputLayout } from "../workspace/OutputLayoutContext";
import styles from "./CodePanel.module.css";

/** The same output tree travels between its inline slot and workspace docking hosts. */
export default function OutputPanelLayout({
  children,
  divider,
  height,
}: {
  children: ReactNode;
  divider: ReactNode;
  height: number;
}) {
  const layout = useOutputLayout();
  const inline = useRef<HTMLDivElement>(null);
  const host = layout?.host;
  const detached = layout?.detached ?? false;
  useLayoutEffect(() => {
    if (
      !detached &&
      host &&
      inline.current &&
      host.parentElement !== inline.current
    )
      inline.current.append(host);
  }, [host, detached]);
  return (
    <>
      {!detached && (
        <>
          {divider}
          <div ref={inline} className={styles.outputSlot} style={{ height }}>
            {!host && children}
          </div>
        </>
      )}
      {host && createPortal(children, host)}
    </>
  );
}
