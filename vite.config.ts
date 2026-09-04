import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  // 5173 고정 — 이미 쓰이고 있으면 다른 포트로 넘어가지 않고 실패시킨다
  // host: true — LAN(192.168.x.x) 에도 바인딩. 휴대폰 등 외부 기기 테스트용
  server: { host: true, port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
