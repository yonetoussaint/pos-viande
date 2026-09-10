"use client";

import { useState, useCallback } from "react";
import Terminal from "./Terminal";

interface TerminalManagerProps {
  codespaceName: string;
  gatewayUrl: string;
  authToken?: string;
}

interface Tab {
  id: string;
  label: string;
}

let tabCounter = 1;

export default function TerminalManager({
  codespaceName,
  gatewayUrl,
  authToken,
}: TerminalManagerProps) {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: crypto.randomUUID(), label: "Windows PowerShell" },
  ]);
  const [activeId, setActiveId] = useState<string>(tabs[0].id);

  const addTab = useCallback(() => {
    tabCounter += 1;
    const id = crypto.randomUUID();
    setTabs((prev) => [...prev, { id, label: `Windows PowerShell ${tabCounter}` }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (id === activeId && next.length > 0) {
          setActiveId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeId]
  );

  return (
    <div className="flex h-full w-full flex-col" style={{ background: "#012456" }}>
      <div
        className="flex items-center"
        style={{ background: "#1f1f1f", borderBottom: "1px solid #000" }}
      >
        <div className="flex flex-1 items-end overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              className="group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm select-none"
              style={{
                background: tab.id === activeId ? "#012456" : "#2b2b2b",
                color: "#FFFFFF",
                borderRight: "1px solid #000",
                fontFamily: "Segoe UI, Consolas, sans-serif",
                minWidth: 140,
                maxWidth: 200,
              }}
            >
              <span className="truncate flex-1">{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="opacity-60 hover:opacity-100"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#FFFFFF",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                }}
                aria-label="Close tab"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={addTab}
            className="px-3 py-2 text-sm hover:bg-white/10"
            style={{ color: "#FFFFFF", background: "transparent", border: "none" }}
            aria-label="New tab"
          >
            +
          </button>
        </div>
      </div>

      <div className="relative flex-1">
        {tabs.map((tab) => (
          <Terminal
            key={tab.id}
            codespaceName={codespaceName}
            gatewayUrl={gatewayUrl}
            authToken={authToken}
            sessionId={tab.id}
            active={tab.id === activeId}
          />
        ))}
      </div>
    </div>
  );
}