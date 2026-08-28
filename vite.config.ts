import { defineConfig } from 'vite'

// The app is loaded by the Even App WebView on the phone, not by a browser on
// this machine. For QR sideload to real glasses, the dev server must be
// reachable on the LAN and HMR must not fall back to "localhost".
export default defineConfig({
  server: {
    host: true, // listen on 0.0.0.0 so the phone can reach it
    port: 5173,
    strictPort: true,
    // When sideloading to hardware, set this to the LAN IP that the QR uses,
    // e.g. hmr: { host: '192.168.1.50' }
    // hmr: { host: '<your-lan-ip>' },
  },
})
