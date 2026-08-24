import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During local dev, forward /api/* to `vercel dev` (run separately)
      // or comment this out and run `vercel dev` which serves both.
    },
  },
});
