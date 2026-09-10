"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  codespaceName: string;
  gatewayUrl: string;
  authToken?: string;
  sessionId: string;   // unique per tab — backend keys the shell/tmux pane on this
  active: boolean;     // controls visibility without unmounting
}

// Classic PowerShell console theme
const POWERSHELL_THEME = {
  background: "#012456",
  foreground: "#FFFFFF",
  cursor: "#FFFFFF",
  cursorAccent: "#012456",
  selectionBackground: "#3A6EA5",
  black: "#0C0C0C",
  red: "#C50F1F",
  green: "#13A10E",
  yellow: "#C19C00",
  blue: "#0037DA",
  magenta: "#881798",
  cyan: "#3A96DD",
  white: "#CCCCCC",
  brightBlack: "#767676",
  brightRed: "#E74856",
  brightGreen: "#16C60C",
  brightYellow: "#F9F1A5",
  brightBlue: "#3B78FF",
  brightMagenta: "#B4009E",
  brightCyan: "#61D6D6",
  brightWhite: "#F2F2F2",
};

export default function Terminal({
  codespaceName,
  gatewayUrl,
  authToken,
  sessionId,
  active,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
      convertEol: true,
      scrollback: 5000,
      theme: POWERSHELL_THEME,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let intentionallyClosed = false;

    const connect = () => {
      const params = new URLSearchParams({
        codespace: codespaceName,
        session: sessionId,
      });
      if (authToken) params.set("token", authToken);
      ws = new WebSocket(`${gatewayUrl}/api/terminal?${params}`);

      ws.onopen = () => {
        reconnectAttempt = 0;
        ws?.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
        );
      };

      ws.onmessage = async (event) => {
        const text =
          typeof event.data === "string"
            ? event.data
            : await event.data.text();
        term.write(text);
      };

      ws.onerror = () => {
        term.write("\r\n\x1b[31mTerminal connection error\x1b[0m\r\n");
      };

      ws.onclose = () => {
        if (intentionallyClosed) return;
        term.write(
          "\r\n\x1b[33mDisconnected — reattaching shortly...\x1b[0m\r\n"
        );
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    const dataDisposable = term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      // fitAddon.fit() throws if the container is hidden (0 size),
      // which happens for inactive tabs — guard it.
      if (containerRef.current.offsetParent === null) return;
      fitAddon.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
        );
      }
    });
    resizeObserver.observe(containerRef.current);

    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        ws?.readyState !== WebSocket.OPEN &&
        ws?.readyState !== WebSocket.CONNECTING
      ) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectAttempt = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      intentionallyClosed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      dataDisposable.dispose();
      resizeObserver.disconnect();
      ws?.close();
      term.dispose();
    };
    // sessionId/codespaceName/gatewayUrl/authToken are fixed for this tab's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit and refocus whenever this tab becomes the active one
  useEffect(() => {
    if (active) {
      fitRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      style={{
        display: active ? "block" : "none",
        background: POWERSHELL_THEME.background,
      }}
    />
  );
}