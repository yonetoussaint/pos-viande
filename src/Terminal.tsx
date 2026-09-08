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

    const params = new URLSearchParams({ codespace: codespaceName });
    if (authToken) params.set("token", authToken);
    const ws = new WebSocket(`${gatewayUrl}/api/terminal?${params}`);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
      );
    };

    ws.onmessage = async (event) => {
      const text =
        typeof event.data === "string" ? event.data : await event.data.text();
      term.write(text);
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31mTerminal connection error\x1b[0m\r\n");
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[33mTerminal disconnected\x1b[0m\r\n");
    };

    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
        );
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [codespaceName, gatewayUrl, authToken]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
