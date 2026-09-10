"use client";

import { useEffect, useState } from "react";
import TerminalManager from "./TerminalManager";

interface Codespace {
  name: string;
  displayName: string;
  repository: string;
  state: string;
}

interface CodespacePickerProps {
  apiUrl: string; // e.g. "https://your-gateway.example.com"
  gatewayUrl: string; // e.g. "wss://your-gateway.example.com"
  authToken?: string;
}

export default function CodespacePicker({
  apiUrl,
  gatewayUrl,
  authToken,
}: CodespacePickerProps) {
  const [codespaces, setCodespaces] = useState<Codespace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiUrl}/api/codespaces`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${r.status}`);
        return r.json();
      })
      .then(setCodespaces)
      .catch((err) => setError(err.message));
  }, [apiUrl, authToken]);

  if (selected) {
    return (
      <TerminalManager
        codespaceName={selected}
        gatewayUrl={gatewayUrl}
        authToken={authToken}
      />
    );
  }

  return (
    <div className="p-4">
      {error && <p className="text-red-500">{error}</p>}
      <ul className="space-y-2">
        {codespaces.map((cs) => (
          <li key={cs.name}>
            <button
              onClick={() => setSelected(cs.name)}
              className="w-full text-left border px-3 py-2 rounded hover:bg-gray-100"
            >
              <div className="font-medium">{cs.displayName}</div>
              <div className="text-sm text-gray-500">
                {cs.repository} — {cs.state}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}