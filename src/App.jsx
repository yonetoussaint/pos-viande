import CodespacePicker from "./CodespacePicker";

const GATEWAY_HTTP_URL = import.meta.env.VITE_GATEWAY_HTTP_URL as string;
const GATEWAY_WS_URL = import.meta.env.VITE_GATEWAY_WS_URL as string;
const GATEWAY_AUTH_TOKEN = import.meta.env.VITE_GATEWAY_AUTH_TOKEN as
  | string
  | undefined;

export default function App() {
  return (
    <div className="h-screen w-screen bg-black text-white">
      <CodespacePicker
        apiUrl={GATEWAY_HTTP_URL}
        gatewayUrl={GATEWAY_WS_URL}
        authToken={GATEWAY_AUTH_TOKEN}
      />
    </div>
  );
}
