import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export default function Terminal() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      theme: { background: '#1e1e1e' },
    });

    term.open(terminalRef.current);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal`);

    ws.onopen = () => {
      term.write('\r\n*** Connecting to Google Cloud Shell... ***\r\n');
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    return () => {
      ws.close();
      term.dispose();
    };
  }, []);

  return <div ref={terminalRef} style={{ width: '100%', height: '100vh' }} />;
}
