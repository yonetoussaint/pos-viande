"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  codespaceName: string;
  gatewayUrl: string; // e.g. "wss://your-gateway.example.com"
  authToken?: string; // GATEWAY_AUTH_TOKEN, if the server has one configured
}

export default function Terminal({
  codespaceName,
  gatewayUrl,
  authToken,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      convertEol: true,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let intentionallyClosed = false;

    const connect = () => {
      const params = new URLSearchParams({ codespace: codespaceName });
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
        // The shell itself keeps running in tmux on the codespace, so
        // reconnecting reattaches to the same session instead of losing it.
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
      fitAddon.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
        );
      }
    });
    resizeObserver.observe(containerRef.current);

    // Reconnect right away when the tab comes back to the foreground,
    // instead of waiting out the backoff timer.
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
  }, [codespaceName, gatewayUrl, authToken]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
